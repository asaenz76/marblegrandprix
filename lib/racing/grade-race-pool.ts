import type { SupabaseClient } from "@supabase/supabase-js";
import { getRacingTemplate } from "@/lib/pools/racing-templates";

/**
 * Racing grading core (Phase 5). Determines WHO WON — it does NOT move money.
 *
 *   RACE_WINNER pool -> current CONFIRMED race_results revision -> winner
 *     -> pool_option whose competitor_id matches -> winning option
 *   COMPETITION_WINNER pool -> racing_competitions.winner_competitor_id
 *     (authoritative; set by Phase 7/finalization) -> winning option
 *
 * Reads only the current authoritative outcome; never DRAFT/SUPERSEDED results
 * or latest-by-created_at. Ambiguous (dead-heat) or winner-not-among-options
 * cases route to MANUAL_REVIEW — never guessed, never split. Writes append-only
 * race_grading_evidence and marks the winning option; re-running on the same
 * source is idempotent. It calls NO settlement RPC — Phase 6 wires
 * result-confirmation -> grading -> settlement as a thin orchestration.
 */

type Client = SupabaseClient;

export type GradeRacePoolStatus =
  | "GRADED"
  | "ALREADY_GRADED"
  | "PENDING"
  | "MANUAL_REVIEW"
  | "NOT_RACING";

export interface GradeRacePoolResult {
  status: GradeRacePoolStatus;
  winningOptionId?: string;
  winnerCompetitorId?: string;
  resultRevisionId?: string;
  reason?: string;
}

export interface RacingPoolRow {
  id: string;
  template_id: string | null;
  template_version: number | null;
  race_id: string | null;
  template_config: Record<string, unknown> | null;
}

async function routeToManualReview(client: Client, poolId: string, reason: string) {
  await client.from("pools").update({ status: "MANUAL_REVIEW", review_reason: reason }).eq("id", poolId);
}

export async function gradeRacePool(client: Client, pool: RacingPoolRow): Promise<GradeRacePoolResult> {
  const template = getRacingTemplate(pool.template_id ?? "", pool.template_version ?? 1);
  if (!template) return { status: "NOT_RACING" };

  // --- Resolve the authoritative winner for this template's scope ---------
  let winnerCompetitorId: string | null = null;
  let resultRevisionId: string | null = null;
  let raceId: string | null = null;
  let competitionId: string | null = null;

  if (template.scope === "RACE") {
    raceId = pool.race_id;
    if (!raceId) return { status: "MANUAL_REVIEW", reason: "RACE_RESULT_UNRESOLVABLE" };

    // Current authoritative revision only. The partial unique index guarantees
    // at most one CONFIRMED revision per race; DRAFT/SUPERSEDED are ignored.
    const { data: result } = await client
      .from("race_results")
      .select("id, winner_competitor_id")
      .eq("race_id", raceId)
      .eq("status", "CONFIRMED")
      .maybeSingle();
    if (!result) return { status: "PENDING" };
    resultRevisionId = result.id;
    winnerCompetitorId = result.winner_competitor_id;

    // Dead heat: >1 competitor sharing position 1 in this revision -> ambiguous.
    // Do not guess a winner; route to manual review. (DNF/DSQ elsewhere does not
    // block a clear single winner — only a shared position 1 does.)
    const { data: firsts } = await client
      .from("race_result_positions")
      .select("competitor_id")
      .eq("race_result_id", resultRevisionId)
      .eq("position", 1);
    if ((firsts ?? []).length > 1) {
      await routeToManualReview(client, pool.id, "RACE_RESULT_UNRESOLVABLE");
      return { status: "MANUAL_REVIEW", reason: "RACE_RESULT_UNRESOLVABLE" };
    }
  } else {
    competitionId = (pool.template_config?.competition_id as string | undefined) ?? null;
    if (!competitionId) return { status: "MANUAL_REVIEW", reason: "RACE_RESULT_UNRESOLVABLE" };
    const { data: comp } = await client
      .from("racing_competitions")
      .select("status, winner_competitor_id")
      .eq("id", competitionId)
      .maybeSingle();
    if (!comp) return { status: "MANUAL_REVIEW", reason: "RACE_RESULT_UNRESOLVABLE" };
    // FINALIZATION GATE: only a competition in its authoritative final state
    // (COMPLETED) can grade. A provisional winner set while the competition is
    // still ACTIVE/DRAFT must NOT grade — the outcome isn't authoritative yet.
    // (We do NOT infer the winner from standings here; Phase 7 owns that.)
    if (comp.status !== "COMPLETED") return { status: "PENDING" };
    // Final, but no authoritative winner recorded -> unresolved final state.
    if (!comp.winner_competitor_id) {
      await routeToManualReview(client, pool.id, "RACE_RESULT_UNRESOLVABLE");
      return { status: "MANUAL_REVIEW", reason: "RACE_RESULT_UNRESOLVABLE" };
    }
    winnerCompetitorId = comp.winner_competitor_id;
  }

  if (!winnerCompetitorId) return { status: "PENDING" };

  // --- Resolve the winning option by competitor identity (N-agnostic) -----
  const { data: options } = await client.from("pool_options").select("id, competitor_id").eq("pool_id", pool.id);
  const winningOption = (options ?? []).find((o) => o.competitor_id === winnerCompetitorId);
  if (!winningOption) {
    await routeToManualReview(client, pool.id, "WINNER_NOT_IN_POOL_OPTIONS");
    return { status: "MANUAL_REVIEW", reason: "WINNER_NOT_IN_POOL_OPTIONS" };
  }

  // --- Idempotency: one evidence row per pool per source ------------------
  let existingQuery = client.from("race_grading_evidence").select("id, winning_option_id").eq("pool_id", pool.id);
  existingQuery = resultRevisionId
    ? existingQuery.eq("result_revision_id", resultRevisionId)
    : existingQuery.is("result_revision_id", null);
  const { data: existing } = await existingQuery.limit(1).maybeSingle();
  if (existing) {
    return {
      status: "ALREADY_GRADED",
      winningOptionId: existing.winning_option_id as string,
      winnerCompetitorId,
      resultRevisionId: resultRevisionId ?? undefined,
    };
  }

  // --- Record the decision (append-only evidence + winning-option flag) ---
  const { error: evErr } = await client.from("race_grading_evidence").insert({
    pool_id: pool.id,
    scope: template.scope,
    race_id: raceId,
    competition_id: competitionId,
    result_revision_id: resultRevisionId,
    winner_competitor_id: winnerCompetitorId,
    winning_option_id: winningOption.id,
    template_id: template.id,
    template_version: template.version,
  });
  // A concurrent grader that won the unique-index race already recorded it —
  // treat as already graded rather than erroring (idempotent).
  if (evErr) {
    return { status: "ALREADY_GRADED", winningOptionId: winningOption.id, winnerCompetitorId, resultRevisionId: resultRevisionId ?? undefined };
  }

  await client.from("pool_options").update({ is_winning_option: false }).eq("pool_id", pool.id);
  await client.from("pool_options").update({ is_winning_option: true }).eq("id", winningOption.id);
  await client.from("pools").update({ winning_option_id: winningOption.id }).eq("id", pool.id);

  return {
    status: "GRADED",
    winningOptionId: winningOption.id,
    winnerCompetitorId,
    resultRevisionId: resultRevisionId ?? undefined,
  };
}
