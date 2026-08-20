import type { SupabaseClient } from "@supabase/supabase-js";
import { computeStandings } from "./standings";
import type { CompetitorIdentityData } from "@/components/racing/CompetitorIdentity";

/**
 * Constructors' championship (F1-style) — a READ-ONLY aggregation layered on top
 * of the existing drivers' standings. A team's points/wins are the sum of its
 * member competitors' points/wins. This calls computeStandings unchanged and
 * never touches winners, grading, settlement, or the per-competitor standings
 * engine. Membership is global (racing_team_members, one team per marble), so
 * attribution uses each driver's current team.
 */

type Client = SupabaseClient;

export interface ConstructorStandingRow {
  teamId: string;
  name: string;
  color: string | null;
  imageUrl: string | null;
  points: number;
  wins: number;
  /** Full current roster, for the clustered team identity. */
  members: CompetitorIdentityData[];
  /** 1-based rank; null when tied with another team on points. */
  rank: number | null;
}

export interface ConstructorStandingsResult {
  competitionId: string;
  rows: ConstructorStandingRow[];
  /** Single team with the strictly-highest positive points, else null. */
  leaderTeamId: string | null;
  topTie: boolean;
}

export async function computeConstructorStandings(
  client: Client,
  competitionId: string,
): Promise<ConstructorStandingsResult> {
  const standings = await computeStandings(client, competitionId);
  const scoredIds = standings.rows.map((r) => r.competitorId);
  const empty: ConstructorStandingsResult = { competitionId, rows: [], leaderTeamId: null, topTie: false };
  if (scoredIds.length === 0) return empty;

  // Which team each scoring driver races for (global membership).
  const { data: memberships } = await client
    .from("racing_team_members")
    .select("competitor_id, team_id")
    .in("competitor_id", scoredIds);
  const teamByCompetitor = new Map<string, string>();
  for (const m of (memberships ?? []) as Array<{ competitor_id: string; team_id: string }>) {
    teamByCompetitor.set(m.competitor_id, m.team_id);
  }
  const teamIds = [...new Set(teamByCompetitor.values())];
  if (teamIds.length === 0) return empty; // no team-affiliated scorers → no constructors

  // Team identities + full rosters (for the clustered display).
  const [{ data: teamRows }, { data: rosterRows }] = await Promise.all([
    client.from("racing_teams").select("id, name, color, image_url").in("id", teamIds),
    client
      .from("racing_team_members")
      .select("team_id, sort_order, competitors ( name, number, colors, image_url )")
      .in("team_id", teamIds)
      .order("sort_order", { ascending: true }),
  ]);

  const teamInfo = new Map<string, { name: string; color: string | null; imageUrl: string | null }>();
  for (const t of (teamRows ?? []) as Array<{ id: string; name: string; color: string | null; image_url: string | null }>) {
    teamInfo.set(t.id, { name: t.name, color: t.color, imageUrl: t.image_url });
  }
  const rosterByTeam = new Map<string, CompetitorIdentityData[]>();
  for (const r of (rosterRows ?? []) as unknown as Array<{
    team_id: string;
    competitors: { name: string | null; number: string | null; colors: string[] | null; image_url: string | null } | null;
  }>) {
    const list = rosterByTeam.get(r.team_id) ?? [];
    list.push({
      name: r.competitors?.name ?? null,
      number: r.competitors?.number ?? null,
      colors: r.competitors?.colors ?? null,
      imageUrl: r.competitors?.image_url ?? null,
    });
    rosterByTeam.set(r.team_id, list);
  }

  // Sum member points/wins into their team.
  const points = new Map<string, number>();
  const wins = new Map<string, number>();
  for (const row of standings.rows) {
    const teamId = teamByCompetitor.get(row.competitorId);
    if (!teamId) continue;
    points.set(teamId, (points.get(teamId) ?? 0) + row.points);
    wins.set(teamId, (wins.get(teamId) ?? 0) + row.wins);
  }

  const rows: ConstructorStandingRow[] = [...points.keys()]
    .map((teamId) => {
      const info = teamInfo.get(teamId);
      return {
        teamId,
        name: info?.name ?? "Team",
        color: info?.color ?? null,
        imageUrl: info?.imageUrl ?? null,
        points: points.get(teamId) ?? 0,
        wins: wins.get(teamId) ?? 0,
        members: rosterByTeam.get(teamId) ?? [],
        rank: null as number | null,
      };
    })
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name) || a.teamId.localeCompare(b.teamId));

  // Unambiguous rank only (a team tied on points with another gets no rank).
  const pointsCount = new Map<number, number>();
  for (const r of rows) pointsCount.set(r.points, (pointsCount.get(r.points) ?? 0) + 1);
  rows.forEach((r, i) => {
    r.rank = (pointsCount.get(r.points) ?? 0) === 1 ? i + 1 : null;
  });

  const topPoints = rows.length ? rows[0].points : 0;
  const topTie = rows.filter((r) => r.points === topPoints).length > 1;
  const leaderTeamId = !topTie && rows.length > 0 && topPoints > 0 ? rows[0].teamId : null;

  return { competitionId, rows, leaderTeamId, topTie: topTie && topPoints > 0 };
}
