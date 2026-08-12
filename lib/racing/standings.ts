import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Racing standings engine (Phase 7). ONE deterministic, on-demand scoring
 * implementation shared by CHAMPIONSHIP and LEAGUE (they differ only in
 * labels/presentation, never in scoring). Standings are COMPUTED from the
 * authoritative confirmed race results — never persisted — so they can never
 * drift from the source of truth and are trivially rebuildable.
 *
 * Determines WHO IS WINNING; it moves NO money and sets no state. Competition
 * finalization (lib/racing/finalize-competition.ts) consumes this to publish the
 * authoritative `winner_competitor_id`, after which the EXISTING Phase 5 grading
 * + Phase 6 settlement path resolves the Competition Winner pool unchanged.
 *
 * Scoring rules (V1, per the approved plan — no bonus/fastest-lap/penalty/
 * dropped-score/tie-break DSL):
 *   - Only the current CONFIRMED race_results revision contributes. DRAFT and
 *     SUPERSEDED revisions are ignored; a race with no confirmed result yet
 *     contributes nothing.
 *   - The confirmed winner (race_results.winner_competitor_id, always present)
 *     is the authoritative 1st place -> points_config["1"].
 *   - FINISHED race_result_positions with position >= 2 award their configured
 *     points; a position beyond the configured map yields 0. Winner-only results
 *     (no position rows) award ONLY the winner. Order is never fabricated.
 *   - DNF/DSQ/DID_NOT_START rows award nothing (no special/negative points).
 *   - A race is AMBIGUOUS (contributes zero points AND blocks finalization) if a
 *     finished position repeats (dead heat), a position-1 row names a non-winner,
 *     or the winner also appears at position >= 2. Points are never silently
 *     split or duplicated.
 */

type Client = SupabaseClient;

export type PointsConfig = Record<string, number>;

export const DEFAULT_POINTS_CONFIG: PointsConfig = { "1": 10, "2": 6, "3": 4, "4": 3, "5": 2, "6": 1 };

export interface StandingRow {
  competitorId: string;
  points: number;
  /** Confirmed, non-ambiguous races in which this competitor scored (won or finished). */
  racesCounted: number;
  /** Races this competitor won (authoritative winner of a confirmed, non-ambiguous race). */
  wins: number;
  /** 1-based rank; null when the competitor is tied with another on points (rank not unambiguous). */
  rank: number | null;
}

export interface StandingsResult {
  competitionId: string;
  pointsConfig: PointsConfig;
  /** Sorted by points desc, then competitorId for stable ordering. */
  rows: StandingRow[];
  /** Confirmed races that could NOT be scored (dead heat / contradictory order). */
  ambiguousRaceIds: string[];
  /** True if any confirmed race is ambiguous — finalization must not proceed. */
  ambiguous: boolean;
  /** The single competitor with the strictly-highest points, or null if none / tied at the top. */
  leaderCompetitorId: string | null;
  /** True if >= 2 competitors share the highest points total. */
  topTie: boolean;
  totalRaces: number;
  confirmedRaces: number;
  /** Non-cancelled races that still lack a current CONFIRMED result. */
  racesAwaitingResult: number;
}

interface RaceResultRow {
  id: string;
  race_id: string;
  winner_competitor_id: string;
}
interface PositionRow {
  race_result_id: string;
  competitor_id: string;
  position: number | null;
  finish_status: "FINISHED" | "DNF" | "DSQ" | "DID_NOT_START";
}

const pointsFor = (cfg: PointsConfig, position: number): number => {
  const v = cfg[String(position)];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

/**
 * Deterministic per-race scoring. Pure: no I/O. Returns the points each
 * competitor earned in this one race, and whether the race is ambiguous
 * (in which case the caller awards nothing from it and blocks finalization).
 */
export function computeRacePoints(
  cfg: PointsConfig,
  winnerCompetitorId: string,
  positions: Array<{ competitorId: string; position: number | null; finishStatus: PositionRow["finish_status"] }>,
): { points: Map<string, number>; scorers: Set<string>; ambiguous: boolean } {
  const points = new Map<string, number>();
  const scorers = new Set<string>();

  const finished = positions.filter((p) => p.finishStatus === "FINISHED" && p.position != null) as Array<{
    competitorId: string;
    position: number;
  }>;

  // Dead heat: any finished position value shared by more than one competitor.
  const perPosition = new Map<number, number>();
  for (const p of finished) perPosition.set(p.position, (perPosition.get(p.position) ?? 0) + 1);
  for (const count of perPosition.values()) if (count > 1) return { points, scorers, ambiguous: true };

  // Contradictions between the authoritative winner and the finishing order.
  for (const p of finished) {
    if (p.position === 1 && p.competitorId !== winnerCompetitorId) return { points, scorers, ambiguous: true };
    if (p.position >= 2 && p.competitorId === winnerCompetitorId) return { points, scorers, ambiguous: true };
  }

  // Winner is the authoritative 1st place.
  points.set(winnerCompetitorId, pointsFor(cfg, 1));
  scorers.add(winnerCompetitorId);

  // Positions 2..N supply the rest (a position-1 row can only be the winner here,
  // already counted, so it is skipped).
  for (const p of finished) {
    if (p.position === 1) continue;
    points.set(p.competitorId, (points.get(p.competitorId) ?? 0) + pointsFor(cfg, p.position));
    scorers.add(p.competitorId);
  }

  return { points, scorers, ambiguous: false };
}

/** Compute live standings for a competition from its confirmed race results. */
export async function computeStandings(client: Client, competitionId: string): Promise<StandingsResult> {
  const { data: comp } = await client
    .from("racing_competitions")
    .select("points_config")
    .eq("id", competitionId)
    .maybeSingle();
  const cfg: PointsConfig = (comp?.points_config as PointsConfig | null) ?? DEFAULT_POINTS_CONFIG;

  const { data: races } = await client.from("races").select("id, status").eq("competition_id", competitionId);
  const allRaces = races ?? [];
  // A cancelled/abandoned race neither scores nor blocks completion.
  const liveRaces = allRaces.filter((r) => r.status !== "CANCELLED" && r.status !== "ABANDONED");
  const liveRaceIds = liveRaces.map((r) => r.id);

  const totals = new Map<string, number>();
  const winCounts = new Map<string, number>();
  const raceCounts = new Map<string, number>();
  const ambiguousRaceIds: string[] = [];
  let confirmedRaces = 0;

  if (liveRaceIds.length) {
    const { data: results } = await client
      .from("race_results")
      .select("id, race_id, winner_competitor_id")
      .in("race_id", liveRaceIds)
      .eq("status", "CONFIRMED");
    const confirmed = (results ?? []) as RaceResultRow[];
    confirmedRaces = confirmed.length;

    const resultIds = confirmed.map((r) => r.id);
    const positionsByResult = new Map<string, PositionRow[]>();
    if (resultIds.length) {
      const { data: posRows } = await client
        .from("race_result_positions")
        .select("race_result_id, competitor_id, position, finish_status")
        .in("race_result_id", resultIds);
      for (const row of (posRows ?? []) as PositionRow[]) {
        const list = positionsByResult.get(row.race_result_id) ?? [];
        list.push(row);
        positionsByResult.set(row.race_result_id, list);
      }
    }

    for (const result of confirmed) {
      const positions = (positionsByResult.get(result.id) ?? []).map((p) => ({
        competitorId: p.competitor_id,
        position: p.position,
        finishStatus: p.finish_status,
      }));
      const scored = computeRacePoints(cfg, result.winner_competitor_id, positions);
      if (scored.ambiguous) {
        ambiguousRaceIds.push(result.race_id);
        continue;
      }
      for (const [competitorId, pts] of scored.points) totals.set(competitorId, (totals.get(competitorId) ?? 0) + pts);
      for (const competitorId of scored.scorers) raceCounts.set(competitorId, (raceCounts.get(competitorId) ?? 0) + 1);
      winCounts.set(result.winner_competitor_id, (winCounts.get(result.winner_competitor_id) ?? 0) + 1);
    }
  }

  // Build rows sorted by points desc, then competitorId (stable, deterministic).
  const rows: StandingRow[] = [...totals.keys()]
    .map((competitorId) => ({
      competitorId,
      points: totals.get(competitorId) ?? 0,
      racesCounted: raceCounts.get(competitorId) ?? 0,
      wins: winCounts.get(competitorId) ?? 0,
      rank: null as number | null,
    }))
    .sort((a, b) => (b.points - a.points) || a.competitorId.localeCompare(b.competitorId));

  // Assign a rank only when unambiguous: a competitor tied on points with another
  // gets no rank (rank is meaningful only where it is not shared).
  const pointsCount = new Map<number, number>();
  for (const r of rows) pointsCount.set(r.points, (pointsCount.get(r.points) ?? 0) + 1);
  rows.forEach((r, i) => {
    r.rank = (pointsCount.get(r.points) ?? 0) === 1 ? i + 1 : null;
  });

  const topPoints = rows.length ? rows[0].points : 0;
  const topHolders = rows.filter((r) => r.points === topPoints);
  const topTie = topHolders.length > 1;
  // A leader exists only when a single competitor holds the strictly-highest,
  // positive score. Zero points (e.g. no confirmed races) is not a win.
  const leaderCompetitorId = !topTie && rows.length > 0 && topPoints > 0 ? rows[0].competitorId : null;

  return {
    competitionId,
    pointsConfig: cfg,
    rows,
    ambiguousRaceIds,
    ambiguous: ambiguousRaceIds.length > 0,
    leaderCompetitorId,
    topTie: topTie && topPoints > 0,
    totalRaces: allRaces.length,
    confirmedRaces,
    racesAwaitingResult: liveRaceIds.length - confirmedRaces,
  };
}
