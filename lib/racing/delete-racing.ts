import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/guards";

/**
 * Operator delete for racing competitions and races (Phase 17). Super-Admin
 * only. Tears down a competition (its races, race-only competitors, and pools)
 * or a single race, in FK-safe order, and — crucially — refunds any live entry
 * through the EXISTING audited money path (void_pool_entry -> apply_wallet_
 * transaction), never by hand-editing balances.
 *
 * Money safety: deletion is refused only if a dependent pool has reached a
 * finalized-money state (SETTLED or a reversal state) — payout records are never
 * destroyed. A pool that is merely OPEN, LOCKED, awaiting a result, or already
 * voided/cancelled has NOT paid out, so its live entries are refunded (fees
 * credited back) and it's removed. A pool that has locked only because its lock
 * time passed is still safely deletable.
 *
 * Runs with the caller's service-role client (bypasses RLS); authority is
 * enforced here and re-enforced by the thin server-action wrapper. No new RPC
 * or SECURITY DEFINER surface is introduced — refunds reuse the same
 * apply_wallet_transaction primitive void_pool_entry itself uses.
 */

type Client = SupabaseClient;

// Only finalized-money states protect a pool from deletion; everything else
// (open, locked, awaiting result, voided, cancelled) has not paid out.
const FINALIZED_POOL_STATUSES = new Set([
  "SETTLED",
  "SETTLEMENT_REVERSED",
  "REVERSAL_FAILED_MANUAL_REVIEW",
]);

export type DeleteResult = { error: string | null };

/** Pure guard: an error string if any pool has settled/reversed, else null. */
export function poolsBlockDeletion(pools: { status: string }[]): string | null {
  const blocked = pools.some((p) => FINALIZED_POOL_STATUSES.has(p.status));
  return blocked
    ? "Can't delete: a pool here has already settled (money paid out). Reverse the settlement first if you really need to remove it."
    : null;
}

async function refundAndDeletePools(
  client: Client,
  actor: UserProfile,
  pools: { id: string }[],
): Promise<string | null> {
  const poolIds = pools.map((p) => p.id);
  if (poolIds.length === 0) return null;

  // Refund every still-active entry before teardown: credit the fee back via
  // apply_wallet_transaction — the exact wallet primitive void_pool_entry uses
  // for its refund — so it works whether the pool is OPEN or already LOCKED
  // (void_pool_entry itself only accepts OPEN pools). A finalized (SETTLED)
  // pool never reaches here; it's blocked by the guard. Only ACTIVE entries owe
  // a refund — a voided/cancelled pool's entries are already REFUNDED. The
  // per-entry idempotency key makes a retry safe (no double credit).
  const { data: activeEntries, error: activeErr } = await client
    .from("entries")
    .select("id, user_id, amount")
    .in("pool_id", poolIds)
    .eq("status", "ACTIVE");
  if (activeErr) return `Could not read entries: ${activeErr.message}`;
  for (const e of activeEntries ?? []) {
    const { error: refundErr } = await client.rpc("apply_wallet_transaction", {
      p_account_type: "user",
      p_user_id: e.user_id,
      p_type: "pool_refund_credit",
      p_direction: "credit",
      p_amount: e.amount,
      p_admin_id: actor.id,
      p_reason: "Pool removed by operator",
      p_idempotency_key: `delete-pool-refund-${e.id}`,
    });
    if (refundErr) return `Could not refund an entry: ${refundErr.message}`;
  }

  // Detach any wallet top-up requests that named these pools (FK would block).
  const { error: wrErr } = await client
    .from("wallet_requests")
    .update({ intended_pool_id: null })
    .in("intended_pool_id", poolIds);
  if (wrErr) return `Could not detach wallet requests: ${wrErr.message}`;

  // Defensive: settlement rows only exist post-settlement (guarded out above),
  // but clear them (and their payouts) before entries so a RESTRICT FK can
  // never block the teardown.
  const { data: allEntries } = await client.from("entries").select("id").in("pool_id", poolIds);
  const entryIds = (allEntries ?? []).map((e) => e.id as string);
  if (entryIds.length) {
    const { error } = await client.from("settlement_payouts").delete().in("entry_id", entryIds);
    if (error) return `Could not clear settlement payouts: ${error.message}`;
  }
  for (const step of [
    () => client.from("notifications").delete().in("pool_id", poolIds),
    () => client.from("settlements").delete().in("pool_id", poolIds),
    () => client.from("correct_prediction_log").delete().in("pool_id", poolIds),
    () => client.from("pool_combo_legs").delete().in("pool_id", poolIds), // no-op for racing pools
    () => client.from("entries").delete().in("pool_id", poolIds),
    () => client.from("pool_options").delete().in("pool_id", poolIds),
    // pool_likes / pool_comments cascade on pool delete.
    () => client.from("pools").delete().in("id", poolIds),
  ]) {
    const { error } = await step();
    if (error) return `Could not tear down pools: ${error.message}`;
  }
  return null;
}

async function deleteRaces(client: Client, raceIds: string[]): Promise<string | null> {
  if (raceIds.length === 0) return null;
  for (const step of [
    () => client.from("race_results").delete().in("race_id", raceIds), // positions cascade
    () => client.from("race_competitors").delete().in("race_id", raceIds),
    // Race-only competitors are scoped to their race; persistent library
    // competitors are shared and intentionally left untouched.
    () => client.from("competitors").delete().in("created_for_race_id", raceIds),
    () => client.from("races").delete().in("id", raceIds),
  ]) {
    const { error } = await step();
    if (error) return `Could not tear down races: ${error.message}`;
  }
  return null;
}

export async function deleteRaceForActor(client: Client, actor: UserProfile, raceId: string): Promise<DeleteResult> {
  if (!isSuperAdmin(actor)) return { error: "Only a Super Admin can delete a race." };
  const { data: race } = await client.from("races").select("id").eq("id", raceId).maybeSingle();
  if (!race) return { error: "That race does not exist." };

  const { data: pools } = await client.from("pools").select("id, status").eq("race_id", raceId);
  const blocked = poolsBlockDeletion(pools ?? []);
  if (blocked) return { error: blocked };

  const poolErr = await refundAndDeletePools(client, actor, pools ?? []);
  if (poolErr) return { error: poolErr };
  const raceErr = await deleteRaces(client, [raceId]);
  if (raceErr) return { error: raceErr };
  return { error: null };
}

export async function deleteCompetitionForActor(
  client: Client,
  actor: UserProfile,
  competitionId: string,
): Promise<DeleteResult> {
  if (!isSuperAdmin(actor)) return { error: "Only a Super Admin can delete a competition." };
  const { data: comp } = await client.from("racing_competitions").select("id").eq("id", competitionId).maybeSingle();
  if (!comp) return { error: "That competition does not exist." };

  const { data: races } = await client.from("races").select("id").eq("competition_id", competitionId);
  const raceIds = (races ?? []).map((r) => r.id as string);

  const { data: compPools } = await client
    .from("pools")
    .select("id, status")
    .eq("template_id", "COMPETITION_WINNER")
    .eq("template_config->>competition_id", competitionId);
  const racePools = raceIds.length
    ? ((await client.from("pools").select("id, status").in("race_id", raceIds)).data ?? [])
    : [];
  const allPools = [...(compPools ?? []), ...racePools];

  const blocked = poolsBlockDeletion(allPools);
  if (blocked) return { error: blocked };

  const poolErr = await refundAndDeletePools(client, actor, allPools);
  if (poolErr) return { error: poolErr };
  const raceErr = await deleteRaces(client, raceIds);
  if (raceErr) return { error: raceErr };

  // competition_stages + competition_organizers cascade on competition delete.
  const { error } = await client.from("racing_competitions").delete().eq("id", competitionId);
  if (error) return { error: `Could not delete the competition: ${error.message}` };
  return { error: null };
}
