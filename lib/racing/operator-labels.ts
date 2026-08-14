import type { SettleRacePoolOutcome } from "@/lib/racing/settle-race-pool";

/**
 * Plain-language labels for operator-facing racing states (Phase 10). Keeps raw
 * enum tokens (SettleRacePoolOutcome, review reasons) out of the operator UI —
 * pure string mapping only, no logic changes.
 */

const OUTCOME_LABEL: Record<SettleRacePoolOutcome, string> = {
  settled: "paid out",
  refunded: "refunded",
  pending: "waiting to settle",
  manualReview: "sent for manual review",
  readyForReview: "awaiting review",
  alreadyTerminal: "already settled",
  notRacing: "unchanged",
  failed: "needs attention",
};

/** Summarize a settlement outcome map as e.g. "2 pools paid out · 1 refunded". */
export function summarizeSettlementOutcomes(outcomes: Record<string, SettleRacePoolOutcome> | undefined): string {
  const values = Object.values(outcomes ?? {});
  if (values.length === 0) return "No pools needed settling.";
  const counts = new Map<string, number>();
  for (const v of values) {
    const label = OUTCOME_LABEL[v] ?? v;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, n]) => `${n} pool${n === 1 ? "" : "s"} ${label}`)
    .join(" · ");
}

/** Plain-language labels for racing pool review reasons shown to operators. */
export const RACING_REVIEW_REASON_TEXT: Record<string, string> = {
  RACE_RESULT_UNRESOLVABLE: "The race result couldn't be matched to a single winning option (for example a tie at the front).",
  WINNER_NOT_IN_POOL_OPTIONS: "The confirmed winner isn't one of this pool's options.",
};
