import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CompetitorIdentityData } from "@/components/racing/CompetitorIdentity";

/**
 * Player-facing racing PRESENTATION layer (Phase 9). Turns the authoritative
 * Phase 2–8 racing model into read-only view-models for the shared pool card,
 * the pool-detail page, and the player race/competition pages. It reads only —
 * it moves no money, computes no payouts, and never writes. Result truth comes
 * strictly from race_results / race_result_positions (current CONFIRMED revision
 * only); it is never inferred from pool grading, and DRAFT/SUPERSEDED revisions
 * are never surfaced.
 */

export type RacingScope = "RACE" | "COMPETITION";
export type FinishStatus = "FINISHED" | "DNF" | "DSQ" | "DID_NOT_START";

/** A finishing-order line for the current confirmed result. */
export interface RaceFinishRow {
  position: number | null;
  competitor: CompetitorIdentityData;
  finishStatus: FinishStatus;
}

/** The current authoritative result of a race, presented truthfully. */
export interface RaceResultView {
  status: "PENDING" | "CONFIRMED" | "AMBIGUOUS";
  /** Only set when a single unambiguous winner exists in the CONFIRMED revision. */
  winner: CompetitorIdentityData | null;
  winnerCompetitorId: string | null;
  /** Finishing order rows, if any were recorded (may be empty = winner-only). */
  order: RaceFinishRow[];
}

/** Racing context attached to a racing pool's card view-model. */
export interface RacingPoolContext {
  scope: RacingScope;
  competitionId: string | null;
  competitionName: string | null;
  competitionFormat: string | null;
  competitionStatus: string | null;
  /** Optional rounded icon for the competition (Phase 16). */
  competitionImageUrl: string | null;
  championCompetitorId: string | null;
  champion: CompetitorIdentityData | null;
  raceId: string | null;
  raceTitle: string | null;
  raceStatus: string | null;
  /** Optional rounded icon for the race (Phase 16). */
  raceImageUrl: string | null;
  scheduledStartUtc: string | null;
  /** optionId -> competitor identity, so the card renders CompetitorIdentity. */
  optionCompetitors: Record<string, CompetitorIdentityData>;
  /** The winning option, derived from the authoritative race/competition winner
   *  (not recomputed money); null until an unambiguous winner exists. */
  winnerOptionId: string | null;
  /** Present for RACE scope once a result exists; null otherwise. */
  result: RaceResultView | null;
}

type IdentityRow = { id: string; name: string | null; number: string | null; colors: string[] | null; image_url: string | null };
const toIdentity = (r: IdentityRow): CompetitorIdentityData => ({ name: r.name, number: r.number, colors: r.colors, imageUrl: r.image_url });

type RawPosition = { competitor_id: string; position: number | null; finish_status: FinishStatus };

/** Pure: fold raw positions + winner into a truthful result view (dead heat at 1st -> AMBIGUOUS). */
function buildResultView(
  winnerCompetitorId: string | null,
  positions: RawPosition[],
  identityById: Map<string, CompetitorIdentityData>,
): RaceResultView {
  const firstPlace = positions.filter((p) => p.finish_status === "FINISHED" && p.position === 1);
  const ambiguous = firstPlace.length > 1;
  const winnerId = ambiguous ? null : winnerCompetitorId;
  return {
    status: ambiguous ? "AMBIGUOUS" : "CONFIRMED",
    winnerCompetitorId: winnerId,
    winner: winnerId ? identityById.get(winnerId) ?? null : null,
    order: positions
      .slice()
      .sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999))
      .map((p) => ({ position: p.position, finishStatus: p.finish_status, competitor: identityById.get(p.competitor_id) ?? { name: null } })),
  };
}

const RACING_TEMPLATES = new Set(["RACE_WINNER", "COMPETITION_WINNER"]);

interface PoolRacingInput {
  id: string;
  template_id: string | null;
  race_id: string | null;
  template_config: Record<string, unknown> | null;
}

/** Is this pool a racing pool (by its template)? */
export function isRacingPool(pool: { template_id: string | null }): boolean {
  return !!pool.template_id && RACING_TEMPLATES.has(pool.template_id);
}

/**
 * Build the racing presentation context for a set of pools, batched (no N+1).
 * Non-racing pools are simply absent from the returned map.
 */
export async function getRacingPoolContexts(pools: PoolRacingInput[]): Promise<Map<string, RacingPoolContext>> {
  const racingPools = pools.filter(isRacingPool);
  const result = new Map<string, RacingPoolContext>();
  if (racingPools.length === 0) return result;

  const admin = createAdminClient();
  const poolIds = racingPools.map((p) => p.id);

  // Option -> competitor (pool_options_public omits competitor_id; read the base
  // table server-side — presentation only, never a browser grant).
  const { data: optionRows } = await admin.from("pool_options").select("id, pool_id, competitor_id").in("pool_id", poolIds);
  const optionsByPool = new Map<string, Array<{ id: string; competitor_id: string | null }>>();
  for (const o of optionRows ?? []) {
    const list = optionsByPool.get(o.pool_id) ?? [];
    list.push({ id: o.id, competitor_id: o.competitor_id });
    optionsByPool.set(o.pool_id, list);
  }

  // Resolve each pool's race and/or competition scope.
  const raceIds = new Set<string>();
  const competitionIds = new Set<string>();
  const perPool = new Map<string, { scope: RacingScope; raceId: string | null; competitionId: string | null }>();
  for (const p of racingPools) {
    if (p.template_id === "RACE_WINNER" && p.race_id) {
      perPool.set(p.id, { scope: "RACE", raceId: p.race_id, competitionId: null });
      raceIds.add(p.race_id);
    } else if (p.template_id === "COMPETITION_WINNER") {
      const competitionId = (p.template_config?.competition_id as string | undefined) ?? null;
      perPool.set(p.id, { scope: "COMPETITION", raceId: null, competitionId });
      if (competitionId) competitionIds.add(competitionId);
    }
  }

  // Batch-load races (and their competition ids).
  const raceById = new Map<string, { id: string; title: string | null; status: string; competition_id: string; scheduled_start_utc: string | null; image_url: string | null }>();
  if (raceIds.size) {
    const { data: races } = await admin.from("races").select("id, title, status, competition_id, scheduled_start_utc, image_url").in("id", [...raceIds]);
    for (const r of races ?? []) {
      raceById.set(r.id, r);
      competitionIds.add(r.competition_id);
    }
  }

  // Batch-load competitions.
  const compById = new Map<string, { id: string; name: string; format: string; status: string; winner_competitor_id: string | null; image_url: string | null }>();
  if (competitionIds.size) {
    const { data: comps } = await admin.from("racing_competitions").select("id, name, format, status, winner_competitor_id, image_url").in("id", [...competitionIds]);
    for (const c of comps ?? []) compById.set(c.id, c);
  }

  // Current CONFIRMED result + positions per race (RACE scope).
  const winnerByRace = new Map<string, { resultId: string; winnerCompetitorId: string | null }>();
  const positionsByRace = new Map<string, RawPosition[]>();
  if (raceIds.size) {
    const { data: results } = await admin.from("race_results").select("id, race_id, winner_competitor_id").in("race_id", [...raceIds]).eq("status", "CONFIRMED");
    const confirmed = results ?? [];
    for (const r of confirmed) winnerByRace.set(r.race_id, { resultId: r.id, winnerCompetitorId: r.winner_competitor_id });
    const resultIds = confirmed.map((r) => r.id);
    if (resultIds.length) {
      const { data: positions } = await admin.from("race_result_positions").select("race_result_id, race_id, competitor_id, position, finish_status").in("race_result_id", resultIds);
      for (const pos of positions ?? []) {
        const list = positionsByRace.get(pos.race_id) ?? [];
        list.push({ competitor_id: pos.competitor_id, position: pos.position, finish_status: pos.finish_status });
        positionsByRace.set(pos.race_id, list);
      }
    }
  }

  // Gather every competitor id needing an identity, then load all in one query.
  const competitorIds = new Set<string>();
  for (const list of optionsByPool.values()) for (const o of list) if (o.competitor_id) competitorIds.add(o.competitor_id);
  for (const w of winnerByRace.values()) if (w.winnerCompetitorId) competitorIds.add(w.winnerCompetitorId);
  for (const list of positionsByRace.values()) for (const p of list) competitorIds.add(p.competitor_id);
  for (const c of compById.values()) if (c.winner_competitor_id) competitorIds.add(c.winner_competitor_id);

  const identityById = new Map<string, CompetitorIdentityData>();
  if (competitorIds.size) {
    const { data: comps } = await admin.from("competitors").select("id, name, number, colors, image_url").in("id", [...competitorIds]);
    for (const c of comps ?? []) identityById.set(c.id, toIdentity(c as IdentityRow));
  }

  const resultByRace = new Map<string, RaceResultView>();
  for (const [raceId, w] of winnerByRace) {
    resultByRace.set(raceId, buildResultView(w.winnerCompetitorId, positionsByRace.get(raceId) ?? [], identityById));
  }

  // Assemble per-pool contexts.
  for (const p of racingPools) {
    const meta = perPool.get(p.id);
    if (!meta) continue;
    const race = meta.raceId ? raceById.get(meta.raceId) : null;
    const competitionId = meta.competitionId ?? race?.competition_id ?? null;
    const comp = competitionId ? compById.get(competitionId) : null;

    const poolOptions = optionsByPool.get(p.id) ?? [];
    const optionCompetitors: Record<string, CompetitorIdentityData> = {};
    for (const o of poolOptions) {
      if (o.competitor_id) {
        const identity = identityById.get(o.competitor_id);
        if (identity) optionCompetitors[o.id] = identity;
      }
    }

    // Winning option from the authoritative winner: the confirmed race winner
    // (RACE scope) or the finalized champion (COMPETITION scope).
    const winnerCompetitorId =
      meta.scope === "RACE" ? resultByRace.get(meta.raceId!)?.winnerCompetitorId ?? null : comp?.winner_competitor_id ?? null;
    const winnerOptionId = winnerCompetitorId
      ? poolOptions.find((o) => o.competitor_id === winnerCompetitorId)?.id ?? null
      : null;

    result.set(p.id, {
      scope: meta.scope,
      competitionId,
      competitionName: comp?.name ?? null,
      competitionFormat: comp?.format ?? null,
      competitionStatus: comp?.status ?? null,
      competitionImageUrl: comp?.image_url ?? null,
      championCompetitorId: comp?.winner_competitor_id ?? null,
      champion: comp?.winner_competitor_id ? identityById.get(comp.winner_competitor_id) ?? null : null,
      raceId: meta.raceId,
      raceTitle: race?.title ?? null,
      raceStatus: race?.status ?? null,
      raceImageUrl: race?.image_url ?? null,
      scheduledStartUtc: race?.scheduled_start_utc ?? null,
      optionCompetitors,
      winnerOptionId,
      result: meta.raceId ? (resultByRace.get(meta.raceId) ?? { status: "PENDING", winner: null, winnerCompetitorId: null, order: [] }) : null,
    });
  }

  return result;
}

/**
 * Standalone truthful result view for a single race (used by the player race
 * page). Current CONFIRMED revision only; dead heat at 1st -> AMBIGUOUS.
 */
export async function getRaceResultView(raceId: string): Promise<RaceResultView> {
  const admin = createAdminClient();
  const { data: result } = await admin.from("race_results").select("id, winner_competitor_id").eq("race_id", raceId).eq("status", "CONFIRMED").maybeSingle();
  if (!result) return { status: "PENDING", winner: null, winnerCompetitorId: null, order: [] };

  const { data: positions } = await admin.from("race_result_positions").select("competitor_id, position, finish_status").eq("race_result_id", result.id);
  const posRows = (positions ?? []) as RawPosition[];
  const competitorIds = new Set<string>(posRows.map((p) => p.competitor_id));
  if (result.winner_competitor_id) competitorIds.add(result.winner_competitor_id);

  const identityById = new Map<string, CompetitorIdentityData>();
  if (competitorIds.size) {
    const { data: comps } = await admin.from("competitors").select("id, name, number, colors, image_url").in("id", [...competitorIds]);
    for (const c of comps ?? []) identityById.set(c.id, toIdentity(c as IdentityRow));
  }
  return buildResultView(result.winner_competitor_id, posRows, identityById);
}
