import Link from "next/link";
import type { HomeStandingRow } from "@/lib/landing/fetch";
import { CompetitorIdentity } from "@/components/racing/CompetitorIdentity";

/**
 * Championship standings snapshot — top five by official points. Practice
 * results never appear here. Movement-from-previous-round is deferred (no
 * prior-snapshot yet), so the table shows position / points / gap / wins.
 */
export function ChampionshipStandings({ rows }: { rows: HomeStandingRow[] }) {
  return (
    <section id="standings" className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl font-extrabold uppercase tracking-wide">Marble Championship</h2>
        <Link href="/register" className="text-sm font-semibold text-accent-primary hover:underline">
          Full standings →
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border-subtle p-8 text-center text-sm text-text-muted">
          Standings open once the first Grand Prix is scored.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border-2 border-border-subtle bg-surface-primary shadow-sticker">
          <table className="w-full text-sm">
            <thead className="bg-surface-secondary text-left text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Pos</th>
                <th className="px-4 py-2 font-semibold">Marble</th>
                <th className="px-4 py-2 text-right font-semibold">Pts</th>
                <th className="px-4 py-2 text-right font-semibold">Gap</th>
                <th className="px-4 py-2 text-right font-semibold">Wins</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {rows.map((row, i) => (
                <tr key={row.marble.id || i}>
                  <td className="px-4 py-3 text-lg font-extrabold tabular-nums">{row.position ?? "—"}</td>
                  <td className="px-4 py-3">
                    <CompetitorIdentity competitor={row.marble} />
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{row.points}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {i === 0 || row.gapToLeader === 0 ? "—" : `-${row.gapToLeader}`}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{row.wins}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
