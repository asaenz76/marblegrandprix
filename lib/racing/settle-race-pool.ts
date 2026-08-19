import type { SupabaseClient } from "@supabase/supabase-js";
import { gradeRacePool, type RacingPoolRow } from "@/lib/racing/grade-race-pool";
import { isNoWinner, isAllWinner } from "@/lib/pools/settlement-logic";
import { createSettlementNotifications, createRefundNotifications } from "@/lib/notifications/create";

/**
 * Racing settlement orchestration (Phase 6). Connects the racing result
 * lifecycle to the EXISTING, proven settlement engine — it does NOT reproduce
 * any payout/fee math and does NOT move money in TypeScript. All wallet mutation
 * stays inside the atomic Postgres RPCs:
 *
 *   gradeRacePool (Phase 5, winner by competitor)  -- who won
 *   -> prepare_pool_settlement_manual              -- settlement proposal (no money)
 *   -> confirm_pool_settlement  (mixed winners)    -- payout, fee, equal-share, atomic
 *      OR confirm_pool_refund   (no/all winner)    -- full refund, no fee, atomic
 *
 * The no-winner / all-winner / below-minimum cases are detected with the same
 * pure invariants the football path uses (isNoWinner / isAllWinner) and refunded
 * automatically — no admin step for the normal path. Ambiguous / winner-missing
 * grading routes to MANUAL_REVIEW (via gradeRacePool) and never settles.
 * Idempotent: repeated runs converge on ONE financial outcome (deterministic
 * idempotency keys; already-terminal pools short-circuit).
 */

type Client = SupabaseClient;

export type SettleRacePoolOutcome =
  | "settled"
  | "refunded"
  | "pending"
  | "manualReview"
  | "readyForReview"
  | "alreadyTerminal"
  | "notRacing"
  | "failed";

const TERMINAL = new Set(["SETTLED", "VOIDED", "CANCELLED", "SETTLEMENT_REVERSED"]);

export async function settleRacePool(client: Client, pool: RacingPoolRow): Promise<SettleRacePoolOutcome> {
  // 1) Determine the winner (Phase 5). No money is touched here.
  const grading = await gradeRacePool(client, pool);
  if (grading.status === "PENDING") return "pending";
  if (grading.status === "MANUAL_REVIEW") return "manualReview";
  if (grading.status === "NOT_RACING") return "notRacing";
  // GRADED or ALREADY_GRADED -> proceed to settle.
  const winningOptionId = grading.winningOptionId!;

  // 2) Read current pool state; short-circuit if already terminal (idempotent).
  const { data: p } = await client.from("pools").select("id, status, snapshot_version, house_fee_bps, stakes").eq("id", pool.id).single();
  if (!p) return "failed";
  if (TERMINAL.has(p.status)) return "alreadyTerminal";

  // Free pools settle with no money at all: grade the winner, mark entries
  // WON/LOST and record the leaderboard credit inside settle_free_pool. None
  // of the money settlement RPCs (prepare/confirm/refund) are ever called.
  if (p.stakes === "FREE") {
    const { error: freeErr } = await client.rpc("settle_free_pool", {
      p_pool_id: pool.id,
      p_winning_option_id: winningOptionId,
    });
    return freeErr ? "failed" : "settled";
  }

  // 3) Move to a gradable status. A confirmed race result means the race is over
  //    and entries are closed. prepare_pool_settlement_manual requires LOCKED or
  //    AWAITING_RESULT; set AWAITING_RESULT (also blocks create_pool_entry, which
  //    requires status = OPEN).
  if (p.status !== "AWAITING_RESULT" && p.status !== "READY_FOR_REVIEW") {
    await client.from("pools").update({ status: "AWAITING_RESULT" }).eq("id", pool.id);
  }

  // 4) Settlement proposal (no money). Idempotent: returns the existing
  //    settlement at the pool's snapshot_version. Sets status READY_FOR_REVIEW.
  const { data: settlement, error: prepErr } = await client.rpc("prepare_pool_settlement_manual", { p_pool_id: pool.id });
  if (prepErr || !settlement) return "failed";
  const gradingVersion = settlement.grading_version as number;

  // 5) Decide payout vs refund using the SAME invariants as the football path.
  const { data: options } = await client.from("pool_options").select("id, competitor_id, entry_count").eq("pool_id", pool.id);
  const totalValidEntries = (options ?? []).reduce((s, o) => s + (o.entry_count ?? 0), 0);
  const winningEntryCount = (options ?? []).find((o) => o.id === winningOptionId)?.entry_count ?? 0;

  if (isNoWinner(winningEntryCount) || isAllWinner(winningEntryCount, totalValidEntries)) {
    // Everyone (or nobody) picked the winner -> full refund, no platform fee.
    const reason = isNoWinner(winningEntryCount) ? "NO_WINNING_ENTRIES" : "ALL_ENTRIES_WINNING";
    const { error: refundErr } = await client.rpc("confirm_pool_refund", {
      p_pool_id: pool.id,
      p_void_reason: reason,
      p_idempotency_key: `${pool.id}:auto_refund:${gradingVersion}`,
      p_admin_id: null,
      p_grading_version: gradingVersion,
    });
    if (refundErr) return "readyForReview";
    const { data: refunded } = await client.from("pools").select("status").eq("id", pool.id).single();
    await createRefundNotifications(pool.id, refunded?.status === "CANCELLED" ? "CANCELLED" : "VOIDED", reason);
    return "refunded";
  }

  // 6) Mixed winners/losers -> stamp the winning option and settle. All payout,
  //    platform-fee, equal-share, and wallet-ledger math is done INSIDE
  //    confirm_pool_settlement; p_admin_id null = system-triggered automatic path.
  await client.from("settlements").update({ winning_option_id: winningOptionId, winning_option_reason: "TEMPLATE_GRADED" }).eq("id", settlement.id);
  const { error: confirmErr } = await client.rpc("confirm_pool_settlement", {
    p_pool_id: pool.id,
    p_admin_id: null,
    p_grading_version: gradingVersion,
    p_idempotency_key: `${pool.id}:auto_settle:${gradingVersion}`,
    p_winning_option_id: winningOptionId,
  });
  if (confirmErr) {
    // Settlement validation couldn't safely complete (stale snapshot, etc.) —
    // the proposal is saved; a human resolves from READY_FOR_REVIEW. No money moved.
    return "readyForReview";
  }
  await createSettlementNotifications(pool.id);
  return "settled";
}

/** Settle every racing prediction pool attached to a race (Race Winner). */
export async function settleRacingPoolsForRace(client: Client, raceId: string): Promise<Record<string, SettleRacePoolOutcome>> {
  const { data: pools } = await client
    .from("pools")
    .select("id, template_id, template_version, race_id, template_config, status")
    .eq("race_id", raceId)
    .eq("pool_type", "TEMPLATE_GRADED");
  const outcomes: Record<string, SettleRacePoolOutcome> = {};
  for (const pool of pools ?? []) {
    outcomes[pool.id] = await settleRacePool(client, pool as RacingPoolRow);
  }
  return outcomes;
}
