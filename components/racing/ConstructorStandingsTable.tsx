import { TeamCluster } from "@/components/racing/TeamCluster";
import type { ConstructorStandingsResult } from "@/lib/racing/constructor-standings";

/**
 * Constructors' championship table (F1-style): Rank · Team (name/logo + member
 * cluster) · Points · Wins. Points are the sum of the team's members' points.
 * The live leader is highlighted; a tie at the top is surfaced plainly.
 */
export function ConstructorStandingsTable({ standings }: { standings: ConstructorStandingsResult }) {
  if (standings.rows.length === 0) {
    return (
      <p className="text-sm text-text-secondary">
        No constructor points yet — assign marbles to teams and confirm a race result.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-surface-secondary text-left text-text-muted">
          <tr>
            <th className="w-10 px-3 py-2">#</th>
            <th className="px-3 py-2">Team</th>
            <th className="px-3 py-2 text-right">Points</th>
            <th className="px-3 py-2 text-right">Wins</th>
          </tr>
        </thead>
        <tbody>
          {standings.rows.map((row) => {
            const isLeader = standings.leaderTeamId === row.teamId;
            return (
              <tr key={row.teamId} className="border-t border-border-subtle">
                <td className="px-3 py-2 tabular-nums text-text-secondary">{row.rank ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2">
                    <TeamCluster team={{ name: row.name, color: row.color, imageUrl: row.imageUrl, members: row.members }} />
                    {isLeader && <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">Leader</span>}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{row.points}</td>
                <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{row.wins}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
