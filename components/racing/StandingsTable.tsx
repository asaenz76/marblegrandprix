import { CompetitorIdentity, type CompetitorIdentityData } from "@/components/racing/CompetitorIdentity";
import type { StandingsResult } from "@/lib/racing/standings";

/**
 * Standings display (Phase 7, §20). Rank · Competitor · Points, plus Wins and
 * Races counted. Mobile-first, no advanced analytics. The champion (when the
 * competition is finalized) and the current leader are highlighted; a tied top
 * or an unscored (ambiguous) race is surfaced plainly rather than hidden.
 */
export function StandingsTable({
  standings,
  competitors,
  winnerCompetitorId,
}: {
  standings: StandingsResult;
  competitors: Map<string, CompetitorIdentityData>;
  winnerCompetitorId: string | null;
}) {
  if (standings.rows.length === 0) {
    return <p className="text-sm text-text-secondary">No points yet — confirm a race result to start the standings.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-surface-secondary text-left text-text-muted dark:bg-transparent dark:text-text-secondary">
          <tr>
            <th className="px-3 py-2 w-10">#</th>
            <th className="px-3 py-2">Competitor</th>
            <th className="px-3 py-2 text-right">Points</th>
            <th className="px-3 py-2 text-right">Wins</th>
            <th className="px-3 py-2 text-right">Races</th>
          </tr>
        </thead>
        <tbody>
          {standings.rows.map((row) => {
            const isChampion = winnerCompetitorId === row.competitorId;
            return (
              <tr key={row.competitorId} className="border-t border-border-subtle">
                <td className="px-3 py-2 tabular-nums text-text-secondary">{row.rank ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2">
                    <CompetitorIdentity competitor={competitors.get(row.competitorId) ?? {}} />
                    {isChampion && <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">Champion</span>}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{row.points}</td>
                <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{row.wins}</td>
                <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{row.racesCounted}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
