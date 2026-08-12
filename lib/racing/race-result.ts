import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { UserProfile } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/guards";
import { isOrganizerOrAbove, userCanManageDescendant } from "@/lib/auth/racing";
import { settleRacePool, settleRacingPoolsForRace, type SettleRacePoolOutcome } from "@/lib/racing/settle-race-pool";
import type { RacingPoolRow } from "@/lib/racing/grade-race-pool";
import { processProgressionForRace, assessDownstreamSafety, type ProgressionResult } from "@/lib/racing/progression";

/**
 * Racing result entry / confirmation core (Phase 6). The organizer records a
 * result (DRAFT), then confirms it — only a CONFIRMED authoritative revision
 * triggers grading + automatic settlement. Never overwrites history: a
 * correction supersedes the prior CONFIRMED revision and adds a new one.
 * Authorization is the Phase 3 boundary (super_admin, or an organizer assigned
 * to the race's competition); players and legacy admin are denied. The confirmed
 * result is the source of truth — client code never chooses the winning option.
 */

type Client = SupabaseClient;

export type RecordResultResult = { error: string | null; resultId?: string };
export type ConfirmResultResult = {
  error: string | null;
  confirmed?: boolean;
  outcomes?: Record<string, SettleRacePoolOutcome>;
  progression?: ProgressionResult;
};

export interface RaceResultPositionInput {
  competitorId: string;
  position: number | null;
  finishStatus?: "FINISHED" | "DNF" | "DSQ" | "DID_NOT_START";
}

/** Record a DRAFT result revision (winner required; finishing order optional). */
export async function recordRaceResultForActor(
  client: Client,
  actor: UserProfile,
  input: { raceId: string; winnerCompetitorId: string; positions?: RaceResultPositionInput[] },
): Promise<RecordResultResult> {
  if (!isOrganizerOrAbove(actor)) return { error: "You are not authorized to record results." };
  if (!(await userCanManageDescendant(client, actor, { raceId: input.raceId }))) {
    return { error: "You are not assigned to manage this race's competition." };
  }

  // Next revision number for this race.
  const { data: existing } = await client
    .from("race_results")
    .select("revision_number")
    .eq("race_id", input.raceId)
    .order("revision_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextRevision = (existing?.revision_number ?? 0) + 1;

  const { data: result, error } = await client
    .from("race_results")
    .insert({ race_id: input.raceId, winner_competitor_id: input.winnerCompetitorId, revision_number: nextRevision, status: "DRAFT" })
    .select("id")
    .single();
  // The composite FK (race_id, winner_competitor_id) -> race_competitors rejects
  // a winner who isn't a participant in the race.
  if (error || !result) return { error: "Could not record the result. The winner must be a competitor in this race." };

  if (input.positions?.length) {
    const rows = input.positions.map((p) => ({
      race_result_id: result.id,
      race_id: input.raceId,
      competitor_id: p.competitorId,
      position: p.position,
      finish_status: p.finishStatus ?? "FINISHED",
    }));
    const { error: posErr } = await client.from("race_result_positions").insert(rows);
    if (posErr) {
      await client.from("race_results").delete().eq("id", result.id);
      return { error: "Could not record the finishing order (a competitor must belong to the race, and appear once)." };
    }
  }

  return { error: null, resultId: result.id };
}

/**
 * Confirm a DRAFT result revision -> CONFIRMED, then grade + settle the race's
 * pools automatically. Idempotent: re-confirming an already-CONFIRMED revision
 * re-runs settlement (which is itself idempotent) without duplicating anything.
 */
export async function confirmRaceResultForActor(
  client: Client,
  actor: UserProfile,
  input: { raceId: string; resultId: string },
): Promise<ConfirmResultResult> {
  if (!isOrganizerOrAbove(actor)) return { error: "You are not authorized to confirm results." };
  if (!(await userCanManageDescendant(client, actor, { raceId: input.raceId }))) {
    return { error: "You are not assigned to manage this race's competition." };
  }

  const { data: result } = await client
    .from("race_results")
    .select("id, race_id, status")
    .eq("id", input.resultId)
    .maybeSingle();
  if (!result || result.race_id !== input.raceId) return { error: "That result does not belong to this race." };
  if (result.status === "SUPERSEDED") return { error: "This result revision has been superseded." };

  if (result.status !== "CONFIRMED") {
    // The partial unique index guarantees at most one CONFIRMED revision per race.
    const { error: confErr } = await client.from("race_results").update({ status: "CONFIRMED", confirmed_by: actor.id, confirmed_at: new Date().toISOString() }).eq("id", result.id).eq("status", "DRAFT");
    if (confErr) return { error: "Could not confirm — another confirmed result already exists for this race." };
  }

  // 1) Settle this race's OWN pools (Phase 6, existing money path).
  const outcomes = await settleRacingPoolsForRace(client, input.raceId);
  // 2) Advance the bracket/elimination structure (Phase 8). Forward-only: it
  //    fills downstream placeholder slots and, if this is the final race,
  //    publishes the competition winner + settles via the existing adapter. It
  //    never overwrites an already-filled slot on the normal path.
  const progression = await processProgressionForRace(client, input.raceId, { actorId: actor.id });
  return { error: null, confirmed: true, outcomes, progression };
}

export type CorrectResultResult = {
  error: string | null;
  outcomes?: Record<string, SettleRacePoolOutcome>;
  progression?: ProgressionResult;
  blockedBy?: Array<{ raceId: string; reasons: string[] }>;
};

/**
 * SUPER-ADMIN-ONLY correction after a result was confirmed/settled. Reuses the
 * proven reversal machinery — no reversal/settlement semantics are changed.
 * History is preserved: the prior CONFIRMED revision is SUPERSEDED (not
 * overwritten), a new CONFIRMED revision is added, and prior grading evidence
 * stays.
 *
 * Phase 8 correction boundary (§3): the correction auto-rebuilds downstream
 * progression ONLY while every affected downstream object is still safely mutable
 * (assessDownstreamSafety). If any downstream race has started, holds a confirmed
 * result, or carries a pool that has moved toward money, the ENTIRE correction is
 * blocked and routed to Super-Admin review — it never reverses/replays a settled
 * downstream tree, and never triggers an automatic financial cascade.
 */
export async function correctRaceResultForActor(
  client: Client,
  actor: UserProfile,
  input: { raceId: string; newWinnerCompetitorId: string; positions?: RaceResultPositionInput[]; reason: string },
): Promise<CorrectResultResult> {
  // Correction after money has moved is Super-Admin authority only. An Organizer
  // must NOT independently trigger settlement reversal.
  if (!isSuperAdmin(actor)) return { error: "Only a Super Admin can correct a confirmed result." };

  const safety = await assessDownstreamSafety(client, input.raceId);
  if (!safety.safe) {
    return {
      error: "This race has downstream progression that is no longer safely mutable — route to Super-Admin review. No automatic cascade is performed.",
      blockedBy: safety.blockedBy,
    };
  }

  // 1) Reverse any SETTLED racing pools on this race (restores wallets atomically).
  const { data: pools } = await client
    .from("pools")
    .select("id, template_id, template_version, race_id, template_config, status")
    .eq("race_id", input.raceId)
    .eq("pool_type", "TEMPLATE_GRADED");
  for (const pool of pools ?? []) {
    if (pool.status === "SETTLED" || pool.status === "REVERSAL_FAILED_MANUAL_REVIEW") {
      const { error } = await client.rpc("reverse_pool_settlement", {
        p_pool_id: pool.id,
        p_admin_id: actor.id,
        p_reason: input.reason,
        p_idempotency_key: `${pool.id}:correction_reverse:${randomUUID()}`,
      });
      if (error) return { error: "Could not reverse the prior settlement; no correction applied." };
    }
  }

  // 2) Supersede the current CONFIRMED revision (history preserved).
  const { data: current } = await client.from("race_results").select("id, revision_number").eq("race_id", input.raceId).eq("status", "CONFIRMED").maybeSingle();
  if (current) {
    await client.from("race_results").update({ status: "SUPERSEDED", superseded_at: new Date().toISOString() }).eq("id", current.id);
  }

  // 3) Add the corrected CONFIRMED revision (winner-in-race enforced by FK).
  const nextRevision = (current?.revision_number ?? 0) + 1;
  const { data: v2, error: v2Err } = await client
    .from("race_results")
    .insert({ race_id: input.raceId, winner_competitor_id: input.newWinnerCompetitorId, revision_number: nextRevision, status: "CONFIRMED", supersedes_result_id: current?.id ?? null, confirmed_by: actor.id, confirmed_at: new Date().toISOString(), correction_reason: input.reason })
    .select("id")
    .single();
  if (v2Err || !v2) return { error: "Could not record the corrected result. The winner must be a competitor in this race." };
  if (input.positions?.length) {
    await client.from("race_result_positions").insert(input.positions.map((p) => ({ race_result_id: v2.id, race_id: input.raceId, competitor_id: p.competitorId, position: p.position, finish_status: p.finishStatus ?? "FINISHED" })));
  }

  // 4) Re-grade + re-settle against v2. Reversed pools are moved back to a
  //    gradable state first (reverse left them SETTLEMENT_REVERSED).
  const outcomes: Record<string, SettleRacePoolOutcome> = {};
  for (const pool of pools ?? []) {
    const { data: p } = await client.from("pools").select("status").eq("id", pool.id).single();
    if (p && (p.status === "SETTLEMENT_REVERSED" || p.status === "MANUAL_REVIEW")) {
      await client.from("pools").update({ status: "AWAITING_RESULT", review_reason: null }).eq("id", pool.id);
    }
    outcomes[pool.id] = await settleRacePool(client, pool as RacingPoolRow);
  }

  // 5) Safe downstream rebuild (§3). Every affected downstream race was verified
  //    still-mutable above, so we may deterministically REPLACE the slots it fed
  //    with the corrected advancement. This does not cascade further: a mutable
  //    downstream race has no confirmed result, so nothing advanced beyond it.
  const progression = await processProgressionForRace(client, input.raceId, { allowReplace: true, actorId: actor.id });
  return { error: null, outcomes, progression };
}
