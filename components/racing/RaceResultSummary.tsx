import { CompetitorIdentity } from "@/components/racing/CompetitorIdentity";
import type { RaceResultView, FinishStatus } from "@/lib/racing/pool-presentation";
import { humanizeEnum } from "@/lib/utils/humanize";

/**
 * Truthful, read-only race result presentation (Phase 9). Renders whatever the
 * current CONFIRMED revision actually holds — a single winner, a winner plus a
 * partial/full finishing order, or an ambiguous (dead-heat) state — and never
 * fabricates missing positions. PENDING shows an "awaiting result" line.
 */
const finishLabel: Partial<Record<FinishStatus, string>> = { DNF: "DNF", DSQ: "DSQ", DID_NOT_START: "DNS" };

export function RaceResultSummary({ result, compact = false }: { result: RaceResultView; compact?: boolean }) {
  if (result.status === "PENDING") {
    return <p className="text-sm text-text-secondary">Awaiting result.</p>;
  }

  if (result.status === "AMBIGUOUS") {
    return <p className="text-sm text-text-secondary">This race ended in a tie at the front — the result is under review.</p>;
  }

  // CONFIRMED
  if (result.order.length === 0) {
    // Winner-only (no recorded finishing order).
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-text-secondary">Winner:</span>
        {result.winner ? <CompetitorIdentity competitor={result.winner} size="sm" /> : <span className="text-text-secondary">recorded</span>}
      </div>
    );
  }

  return (
    <ol className={compact ? "space-y-1" : "space-y-1.5"}>
      {result.order.map((row, i) => (
        <li key={i} className="flex items-center gap-2 text-sm">
          <span className="w-5 shrink-0 text-right tabular-nums text-text-secondary">{row.position ?? "—"}</span>
          <CompetitorIdentity competitor={row.competitor} size="sm" />
          {row.finishStatus !== "FINISHED" && (
            <span className="rounded-full bg-surface-secondary px-1.5 py-0.5 text-xs text-text-secondary">{finishLabel[row.finishStatus] ?? humanizeEnum(row.finishStatus)}</span>
          )}
        </li>
      ))}
    </ol>
  );
}
