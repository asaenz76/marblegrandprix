import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { settleRacePool, type SettleRacePoolOutcome } from "@/lib/racing/settle-race-pool";
import type { RacingPoolRow } from "@/lib/racing/grade-race-pool";

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
