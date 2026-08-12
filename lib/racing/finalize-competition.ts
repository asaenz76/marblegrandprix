import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { UserProfile } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/guards";
import { isOrganizerOrAbove, userCanManageCompetition } from "@/lib/auth/racing";
import { computeStandings, type StandingsResult } from "@/lib/racing/standings";
import { settleRacePool, type SettleRacePoolOutcome } from "@/lib/racing/settle-race-pool";
import type { RacingPoolRow } from "@/lib/racing/grade-race-pool";
import { writeAuditLog } from "@/lib/audit/log";

/**
 * Competition finalization (Phase 7). Publishes the AUTHORITATIVE competition
 * outcome — `racing_competitions.winner_competitor_id` + status = COMPLETED —
 * derived deterministically from standings. It never moves money itself; once
 * the outcome is published, the EXISTING Phase 5 Competition Winner grading and
 * Phase 6 settlement adapter resolve the pool unchanged (no new payout math).
 *
 * The winner is DERIVED, never human-chosen (§12/§18): an Organizer may trigger
 * finalization, but neither an Organizer nor a Super Admin picks the champion —
 * a tie leaves the competition unresolved. No tie-break engine (§13).
 *
 * Completion is an explicit, gated action (§11/§22): the schema has no
 * "planned race count", so we do not guess when a competition is "done". The
 * caller asserts completeness by invoking finalize; the system still refuses
 * unless every non-cancelled race carries a current CONFIRMED result. Ambiguous
 * (dead-heat) standings block finalization (§7). A tie at the top leaves the
 * competition ACTIVE with a null winner — the `competition_status` enum has no
 * dedicated unresolved state, so "ACTIVE + null winner" IS that representation
 * (no new lifecycle state is invented).
 */

type Client = SupabaseClient;

export type FinalizeOutcome =
  | "finalized" // unique champion published; status -> COMPLETED
  | "tied" // top score shared -> no winner, competition stays ACTIVE
  | "ambiguous" // dead-heat race -> cannot score -> no winner
  | "incomplete" // a non-cancelled race lacks a confirmed result
  | "notStandings" // SINGLE_RACE / BRACKET / etc. — no standings winner here
  | "alreadyFinal" // already COMPLETED — refuse to silently overwrite
  | "cancelled" // competition is CANCELLED
  | "unauthorized";

export interface FinalizeResult {
  outcome: FinalizeOutcome;
  error?: string;
  winnerCompetitorId?: string;
  standings?: StandingsResult;
  /** Competition Winner pool settlement outcomes (poolId -> outcome), when finalized. */
  poolOutcomes?: Record<string, SettleRacePoolOutcome>;
}

const STANDINGS_FORMATS = new Set(["CHAMPIONSHIP", "LEAGUE"]);

/**
 * Find and settle every Competition Winner pool for a competition (Phase 6
 * adapter). Includes a STALE-EVIDENCE GUARD: racing grading evidence is
 * append-only and, for COMPETITION scope, keyed on a null revision — so after a
 * champion is CORRECTED, the prior evidence still names the OLD winner and
 * gradeRacePool would report ALREADY_GRADED against the stale option. Rather
 * than ever re-settle money to a stale backer, a pool whose recorded evidence
 * names a different winner than the freshly-published one is routed to
 * MANUAL_REVIEW for a Super Admin to resolve. Money is never moved on a stale
 * decision; the common (first-time) path has no evidence and settles normally.
 */
export async function settleCompetitionPools(
  client: Client,
  competitionId: string,
  publishedWinnerId: string,
): Promise<Record<string, SettleRacePoolOutcome>> {
  const { data: pools } = await client
    .from("pools")
    .select("id, template_id, template_version, race_id, template_config, status")
    .eq("pool_type", "TEMPLATE_GRADED")
    .eq("template_id", "COMPETITION_WINNER")
    .contains("template_config", { competition_id: competitionId });
  const outcomes: Record<string, SettleRacePoolOutcome> = {};
  for (const pool of pools ?? []) {
    const { data: ev } = await client
      .from("race_grading_evidence")
      .select("winner_competitor_id")
      .eq("pool_id", pool.id)
      .eq("scope", "COMPETITION")
      .limit(1)
      .maybeSingle();
    if (ev && ev.winner_competitor_id !== publishedWinnerId) {
      // Park in MANUAL_REVIEW — a state the reconcile fallback ignores — so no
      // path (including the cron) can auto-re-settle to the stale winner. Reuse
      // the existing racing review reason (the winner can't be auto-resolved).
      const { error } = await client
        .from("pools")
        .update({ status: "MANUAL_REVIEW", review_reason: "RACE_RESULT_UNRESOLVABLE" })
        .eq("id", pool.id);
      outcomes[pool.id] = error ? "failed" : "manualReview";
      continue;
    }
    outcomes[pool.id] = await settleRacePool(client, pool as RacingPoolRow);
  }
  return outcomes;
}

/**
 * Determine completion + winner from standings and publish it. Shared by the
 * normal finalize action and the Super-Admin re-finalize/correction path.
 * Does NOT authorize — callers must have already authorized.
 */
async function evaluateAndPublish(
  client: Client,
  actor: UserProfile,
  competitionId: string,
  comp: { status: string; format: string },
): Promise<FinalizeResult> {
  if (comp.status === "CANCELLED") return { outcome: "cancelled", error: "This competition is cancelled." };
  if (!STANDINGS_FORMATS.has(comp.format)) {
    return { outcome: "notStandings", error: "Only a Championship or League is finalized from standings." };
  }

  // Completion gate: there must be at least one race, and every non-cancelled
  // race must carry a current CONFIRMED result. We never infer a "planned" count.
  const { data: races } = await client.from("races").select("id, status").eq("competition_id", competitionId);
  const liveRaces = (races ?? []).filter((r) => r.status !== "CANCELLED" && r.status !== "ABANDONED");
  if (liveRaces.length === 0) return { outcome: "incomplete", error: "This competition has no races to finalize." };

  const { data: confirmed } = await client
    .from("race_results")
    .select("race_id")
    .in("race_id", liveRaces.map((r) => r.id))
    .eq("status", "CONFIRMED");
  const confirmedRaceIds = new Set((confirmed ?? []).map((r) => r.race_id));
  if (confirmedRaceIds.size < liveRaces.length) {
    return { outcome: "incomplete", error: "Every race needs a confirmed result before the competition can be finalized." };
  }

  const standings = await computeStandings(client, competitionId);
  if (standings.ambiguous) {
    return { outcome: "ambiguous", error: "A race has a tied finish — standings can't be scored. Resolve it before finalizing.", standings };
  }
  if (standings.topTie || !standings.leaderCompetitorId) {
    return { outcome: "tied", error: "The top of the standings is tied — no automatic champion. A Super Admin can resolve it.", standings };
  }

  const winnerCompetitorId = standings.leaderCompetitorId;

  // Publish the authoritative outcome. The optimistic status guard makes the
  // transition idempotent under concurrency (only one writer flips ACTIVE/DRAFT
  // -> COMPLETED). We never overwrite an already-COMPLETED competition here.
  const { data: updated, error: updErr } = await client
    .from("racing_competitions")
    .update({ status: "COMPLETED", winner_competitor_id: winnerCompetitorId })
    .eq("id", competitionId)
    .in("status", ["DRAFT", "ACTIVE"])
    .select("id")
    .maybeSingle();
  if (updErr) return { outcome: "unauthorized", error: "Could not finalize the competition." };
  if (!updated) {
    // Another writer finalized between our read and write — fall through to
    // settlement (idempotent) using the now-current winner.
  }

  await writeAuditLog({
    actorId: actor.id,
    action: "racing_competition.finalize",
    entityType: "racing_competition",
    entityId: competitionId,
    after: {
      winner_competitor_id: winnerCompetitorId,
      status: "COMPLETED",
      standings: standings.rows,
      points_config: standings.pointsConfig,
      confirmed_races: standings.confirmedRaces,
    },
  });

  const poolOutcomes = await settleCompetitionPools(client, competitionId, winnerCompetitorId);
  return { outcome: "finalized", winnerCompetitorId, standings, poolOutcomes };
}

/**
 * Normal finalization. Organizer-or-above with assignment to the competition.
 * Refuses to overwrite an already-COMPLETED competition (no silent rewrite) —
 * correcting a finalized competition is the Super-Admin path below.
 */
export async function finalizeCompetitionForActor(
  client: Client,
  actor: UserProfile,
  competitionId: string,
): Promise<FinalizeResult> {
  if (!isOrganizerOrAbove(actor)) return { outcome: "unauthorized", error: "You are not authorized to finalize competitions." };
  if (!(await userCanManageCompetition(client, actor, competitionId))) {
    return { outcome: "unauthorized", error: "You are not assigned to manage this competition." };
  }

  const { data: comp } = await client.from("racing_competitions").select("status, format, winner_competitor_id").eq("id", competitionId).maybeSingle();
  if (!comp) return { outcome: "unauthorized", error: "That competition does not exist." };
  if (comp.status === "COMPLETED") {
    return { outcome: "alreadyFinal", error: "This competition is already finalized. A Super Admin must correct it to change the outcome.", winnerCompetitorId: comp.winner_competitor_id ?? undefined };
  }

  return evaluateAndPublish(client, actor, competitionId, comp);
}

/**
 * SUPER-ADMIN-ONLY correction of a finalized competition (§16/§29). Used after a
 * race result was corrected and the competition needs re-finalizing. Reuses the
 * EXISTING reversal machinery — it does not change settlement/reversal semantics.
 *
 *   - Competition Winner pool already SETTLED -> reverse it (restores wallets
 *     atomically via reverse_pool_settlement), then re-finalize from corrected
 *     standings. This is the only way a settled winner may change.
 *   - Finalized but pool not settled -> reset to ACTIVE + null winner and
 *     re-finalize (dependencies still mutable, no money moved).
 *   - Not yet finalized -> just finalize.
 *
 * A tie/ambiguity after correction leaves the competition unresolved (ACTIVE,
 * null winner) with the prior settlement already reversed — no arbitrary winner.
 * When the corrected champion DIFFERS from a previously-settled one, the money is
 * reversed and the pool is routed to MANUAL_REVIEW (append-only grading evidence
 * still names the old winner) — a Super Admin resolves the pool; money is never
 * moved to a stale backer. When the champion is unchanged, it re-settles cleanly.
 */
export async function refinalizeCompetitionForActor(
  client: Client,
  actor: UserProfile,
  competitionId: string,
  reason: string,
): Promise<FinalizeResult> {
  if (!isSuperAdmin(actor)) return { outcome: "unauthorized", error: "Only a Super Admin can correct a finalized competition." };

  const { data: comp } = await client.from("racing_competitions").select("status, format, winner_competitor_id").eq("id", competitionId).maybeSingle();
  if (!comp) return { outcome: "unauthorized", error: "That competition does not exist." };

  // 1) Reverse any SETTLED Competition Winner pools (existing reversal machinery).
  const { data: pools } = await client
    .from("pools")
    .select("id, status")
    .eq("pool_type", "TEMPLATE_GRADED")
    .eq("template_id", "COMPETITION_WINNER")
    .contains("template_config", { competition_id: competitionId });
  for (const pool of pools ?? []) {
    if (pool.status === "SETTLED" || pool.status === "REVERSAL_FAILED_MANUAL_REVIEW") {
      const { error } = await client.rpc("reverse_pool_settlement", {
        p_pool_id: pool.id,
        p_admin_id: actor.id,
        p_reason: reason,
        p_idempotency_key: `${pool.id}:competition_correction:${randomUUID()}`,
      });
      if (error) return { outcome: "unauthorized", error: "Could not reverse the prior Competition Winner settlement; no correction applied." };
    }
  }

  // 2) Clear the stale finalization so evaluateAndPublish can re-derive it.
  if (comp.status === "COMPLETED") {
    await client.from("racing_competitions").update({ status: "ACTIVE", winner_competitor_id: null }).eq("id", competitionId);
  }
  // 3) Move any reversed pools back to a gradable state (mirrors Phase 6 correction).
  for (const pool of pools ?? []) {
    const { data: p } = await client.from("pools").select("status").eq("id", pool.id).single();
    if (p && (p.status === "SETTLEMENT_REVERSED" || p.status === "MANUAL_REVIEW")) {
      await client.from("pools").update({ status: "AWAITING_RESULT", review_reason: null }).eq("id", pool.id);
    }
  }

  await writeAuditLog({
    actorId: actor.id,
    action: "racing_competition.refinalize",
    entityType: "racing_competition",
    entityId: competitionId,
    before: { status: comp.status, winner_competitor_id: comp.winner_competitor_id },
    reason,
  });

  // 4) Re-derive + re-publish from corrected standings.
  return evaluateAndPublish(client, actor, competitionId, { status: "ACTIVE", format: comp.format });
}
