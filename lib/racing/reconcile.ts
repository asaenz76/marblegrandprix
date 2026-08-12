import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { settleRacePool, type SettleRacePoolOutcome } from "@/lib/racing/settle-race-pool";
import type { RacingPoolRow } from "@/lib/racing/grade-race-pool";
import { processProgressionForRace } from "@/lib/racing/progression";

/**
 * Racing settlement reconciliation (Phase 6, §20). The NORMAL path is
 * event-driven (confirm result -> grade -> settle). This is only an idempotent
 * safety net for a pool that never settled (a transient error, a restart
 * mid-request): it re-runs settleRacePool over non-terminal racing pools.
 * settleRacePool is idempotent and returns PENDING when a pool isn't ready, so
 * this is safe to run repeatedly and never double-pays. No new scheduler — it
 * hangs off the existing process-results cron.
 */
const NON_TERMINAL = ["OPEN", "LOCKED", "AWAITING_RESULT", "READY_FOR_REVIEW"];

export async function reconcileRacingSettlements(): Promise<Record<string, SettleRacePoolOutcome>> {
  const admin = createAdminClient();
  const { data: pools } = await admin
    .from("pools")
    .select("id, template_id, template_version, race_id, template_config, status")
    .eq("pool_type", "TEMPLATE_GRADED")
    .in("template_id", ["RACE_WINNER", "COMPETITION_WINNER"])
    .in("status", NON_TERMINAL);

  const outcomes: Record<string, SettleRacePoolOutcome> = {};
  for (const pool of pools ?? []) {
    outcomes[pool.id] = await settleRacePool(admin, pool as RacingPoolRow);
  }
  return outcomes;
}

/**
 * Racing progression reconciliation (Phase 8 §12). Idempotent safety net for the
 * event-driven path: for each non-completed BRACKET/ELIMINATION competition, it
 * re-runs progression over every race that already has a CONFIRMED result. This
 * fills any downstream placeholder slot that a transient error left empty and
 * publishes the champion once the final race is confirmed. processProgressionForRace
 * is idempotent (already-filled slots are no-ops; it never overwrites on this
 * forward path), so it is safe to run repeatedly. No new scheduler — it hangs off
 * the existing process-results cron alongside settlement reconciliation.
 */
export async function reconcileRacingProgression(): Promise<{ competitionsScanned: number; racesProcessed: number }> {
  const admin = createAdminClient();
  const { data: comps } = await admin
    .from("racing_competitions")
    .select("id")
    .in("format", ["BRACKET", "ELIMINATION"])
    .in("status", ["DRAFT", "ACTIVE"]);

  let racesProcessed = 0;
  for (const comp of comps ?? []) {
    const { data: races } = await admin.from("races").select("id").eq("competition_id", comp.id);
    const raceIds = (races ?? []).map((r) => r.id);
    if (!raceIds.length) continue;
    const { data: confirmed } = await admin.from("race_results").select("race_id").in("race_id", raceIds).eq("status", "CONFIRMED");
    for (const r of confirmed ?? []) {
      await processProgressionForRace(admin, r.race_id as string);
      racesProcessed += 1;
    }
  }
  return { competitionsScanned: (comps ?? []).length, racesProcessed };
}
