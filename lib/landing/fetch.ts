import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPoolCardViewModel, type SocialPoolCardViewModel } from "@/lib/pools/view-model";
import { getRacingPoolContexts, getRaceResultView } from "@/lib/racing/pool-presentation";
import { computeStandings } from "@/lib/racing/standings";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export interface LandingStats {
  betaTesters: number;
  predictionsMade: number;
  poolsCompleted: number;
}

export interface LandingActivityPoint {
  timestamp: string;
  value: number;
}

export interface LandingActivityItem {
  id: string;
  text: string;
  createdAt: string;
}

export interface LandingLeaderboardEntry {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  correctCount: number;
  totalCount: number;
  rank: number;
}

export interface LandingSampleAnalytics {
  displayName: string;
  poolsEntered: number;
  currentStreak: number;
  predictionAccuracy: { correct: number; total: number };
  balancePoints: LandingActivityPoint[];
}

export interface LandingPageData {
  stats: LandingStats;
  heroPool: SocialPoolCardViewModel | null;
  feedPools: SocialPoolCardViewModel[];
  leaderboard: LandingLeaderboardEntry[];
  activity: LandingActivityItem[];
  sampleAnalytics: LandingSampleAnalytics | null;
}

// Only pools that are already unambiguously public within the app itself —
// open to every member and configured to show picks/percentages before
// anyone has to enter — are eligible for the pre-login marketing page.
// Anything HIDDEN, invite-scoped, or SHOW_AFTER_ENTRY/SHOW_AFTER_LOCK stays
// exactly as private to a logged-out visitor as it already is to a
// logged-in one who hasn't entered yet.
const PUBLIC_POOL_FILTERS = {
  status: "OPEN",
  visibility: "VISIBLE_TO_ALL_MEMBERS",
  participation_visibility: "SHOW_BEFORE_ENTRY",
} as const;

// No real visitor session exists pre-login, so there's no "current user" to
// scope entries/likes to — every card renders in its plain, unentered state
// (no "Your Choice" badge, no like state), which is exactly what a
// marketing preview should show anyway.
async function buildPublicViewModel(
  admin: ReturnType<typeof createAdminClient>,
  pool: Record<string, unknown>,
): Promise<SocialPoolCardViewModel | null> {
  const poolId = pool.id as string;

  const [{ data: fixture }, { data: options }, { data: totalsRows }, { data: participantsRows }] =
    await Promise.all([
      pool.fixture_id
        ? admin.from("fixtures").select("*").eq("id", pool.fixture_id as string).single()
        : Promise.resolve({ data: null }),
      // pool_options_public is only granted to `authenticated` (it exists
      // to null out aggregates for viewers who can't see distribution yet)
      // — service_role has no grant on it at all. The admin client reads
      // the base table directly instead, which is fine here: every pool
      // eligible for this page is already filtered to SHOW_BEFORE_ENTRY,
      // i.e. exactly the case where that view would never null anything
      // out anyway.
      admin.from("pool_options").select("*").eq("pool_id", poolId),
      admin.rpc("get_pool_totals", { p_pool_id: poolId }),
      admin.rpc("get_pool_participants", { p_pool_id: poolId }),
    ]);

  if (!options || options.length === 0) return null;

  const fixtureRow = fixture ?? {
    competition_name: null,
    competition_country: null,
    competition_logo_url: null,
    round: null,
    scheduled_start_utc: pool.locks_at,
    home_team_name: "",
    home_team_logo_url: null,
    away_team_name: "",
    away_team_logo_url: null,
    internal_status: "NOT_STARTED",
    elapsed_minutes: null,
    home_score: null,
    away_score: null,
  };

  const totalsRaw = Array.isArray(totalsRows) ? totalsRows[0] : totalsRows;
  const participants = (participantsRows ?? []) as Array<{
    display_name: string;
    avatar_url: string | null;
  }>;

  // Same racing presentation context the logged-in Feed builds via
  // getPoolCardViewModels — without it, a racing pool would fall back to the
  // generic football labels ("Custom Poll" / "fixture result") and lose its
  // competition name on the marketing page.
  const racingByPoolId = await getRacingPoolContexts([
    {
      id: poolId,
      template_id: (pool.template_id as string | null) ?? null,
      race_id: (pool.race_id as string | null) ?? null,
      template_config: (pool.template_config as Record<string, unknown> | null) ?? null,
    },
  ]);

  return buildPoolCardViewModel({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pool: pool as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fixture: fixtureRow as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: options as any,
    currentUserEntry: null,
    totals: totalsRaw ?? { total_entries: 0, gross_pool: 0 },
    participants,
    participantCount: participants.length,
    finalPayout: null,
    isLikedByCurrentUser: false,
    comboLegs: [],
    racing: racingByPoolId.get(poolId) ?? null,
  });
}

export async function getLandingPageData(): Promise<LandingPageData> {
  const admin = createAdminClient();

  const [
    { count: betaTesters },
    { count: predictionsMade },
    { count: poolsCompleted },
    { data: candidatePools },
    { data: leaderboardRows },
  ] = await Promise.all([
    admin
      .from("user_profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "player")
      .eq("is_active", true),
    admin.from("entries").select("id", { count: "exact", head: true }),
    admin
      .from("pools")
      .select("id", { count: "exact", head: true })
      .eq("status", "SETTLED"),
    admin
      .from("pools")
      .select("*")
      .match(PUBLIC_POOL_FILTERS)
      // Same race the lock cron corrects for everywhere else (see
      // effectivePoolStatus): a pool past its locks_at can sit with
      // status still 'OPEN' until that job catches up. A marketing page
      // has even less excuse to show a stale one than Feed does.
      .gt("locks_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(20),
    // p_caller_id is only consulted for the "following" scope — ignored
    // entirely by the SQL function's WHERE clause when p_scope is
    // "global", so a fixed nil UUID (no real visitor exists pre-login) is
    // safe here.
    admin.rpc("get_leaderboard", {
      p_scope: "global",
      p_range: "all_time",
      p_caller_id: "00000000-0000-0000-0000-000000000000",
    }),
  ]);

  const pools = candidatePools ?? [];

  const totalsByPool = await Promise.all(
    pools.map(async (pool) => {
      const { data } = await admin.rpc("get_pool_totals", { p_pool_id: pool.id as string });
      const row = Array.isArray(data) ? data[0] : data;
      return { pool, totalEntries: row?.total_entries ?? 0 };
    }),
  );

  const ranked = totalsByPool
    .filter((p) => p.totalEntries > 0)
    .sort((a, b) => b.totalEntries - a.totalEntries);

  const heroCandidate = ranked[0]?.pool ?? pools[0] ?? null;
  const otherPools = ranked
    .slice(1, 3)
    .map((p) => p.pool)
    .concat(pools.filter((p) => p.id !== heroCandidate?.id))
    .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i);
  // A single real open pool is still a real feed — better to show the
  // hero pool a second time here than to leave "Your feed" empty just
  // because there's nothing else open yet. Widened past 2 so a competition's
  // winner + race pools can appear together and fold into one nested card
  // (groupPoolsByCompetition collapses the races, so it stays compact).
  const feedCandidates = (otherPools.length > 0 ? otherPools : heroCandidate ? [heroCandidate] : []).slice(
    0,
    8,
  );

  const [heroPool, feedPools] = await Promise.all([
    heroCandidate ? buildPublicViewModel(admin, heroCandidate) : Promise.resolve(null),
    Promise.all(feedCandidates.map((p) => buildPublicViewModel(admin, p))),
  ]);

  const leaderboard: LandingLeaderboardEntry[] = (leaderboardRows ?? [])
    .slice(0, 5)
    .map(
      (row: {
        user_id: string;
        display_name: string;
        username: string | null;
        avatar_url: string | null;
        correct_count: number;
        total_count: number;
        rank: number;
      }) => ({
        userId: row.user_id,
        displayName: row.display_name,
        username: row.username,
        avatarUrl: row.avatar_url,
        correctCount: row.correct_count,
        totalCount: row.total_count,
        rank: row.rank,
      }),
    );

  const activity = await getRecentActivity(admin);
  // Rank 1 (with SQL tiebreakers already applied by get_leaderboard) is
  // "whoever has the best record so far" — the real top-of-leaderboard
  // player, not an arbitrary pick.
  const topUser = leaderboard[0];
  const sampleAnalytics = topUser ? await getSampleUserAnalytics(admin, topUser) : null;

  return {
    stats: {
      betaTesters: betaTesters ?? 0,
      predictionsMade: predictionsMade ?? 0,
      poolsCompleted: poolsCompleted ?? 0,
    },
    heroPool,
    feedPools: feedPools.filter((vm): vm is SocialPoolCardViewModel => vm != null),
    leaderboard,
    activity,
    sampleAnalytics,
  };
}

// ============================================================================
// Homepage (v2) — motorsport "Grand Prix Championship" model.
// Practice Race = free Single-Race pool; Grand Prix = a Championship race with
// a cash pool. All read-only, from the same admin client. Qualifying/grid are
// deferred, so those modules render a simplified state for now.
// ============================================================================

export interface MarbleIdentity {
  id: string;
  name: string | null;
  number: string | null;
  colors: string[];
  imageUrl: string | null;
}

export interface HomeStandingRow {
  /** Championship position (1-based); null when tied on points with another. */
  position: number | null;
  marble: MarbleIdentity;
  points: number;
  wins: number;
  /** Points behind the leader (0 for the leader). */
  gapToLeader: number;
}

export interface HomeRound {
  raceId: string;
  title: string;
  roundNumber: number | null;
  scheduledStartUtc: string | null;
  status: string;
  /** Confirmed winner marble, when the round has a confirmed result. */
  winner: MarbleIdentity | null;
}

export interface HomepageData {
  championship: { id: string; name: string; imageUrl: string | null; status: string } | null;
  /** The next official Grand Prix round (a scheduled championship race). */
  nextGrandPrix: HomeRound | null;
  /** The paid cash pool tied to the next Grand Prix (or the championship winner pool). */
  grandPrixPool: SocialPoolCardViewModel | null;
  /** An open free Single-Race pool — "Today's Practice Race". */
  practiceRace: SocialPoolCardViewModel | null;
  /** Top-5 championship standings. */
  standings: HomeStandingRow[];
  /** Every marble in the championship, standings order — "Meet the Grid". */
  grid: HomeStandingRow[];
  /** Next official Grand Prix rounds (up to 5). */
  upcomingRounds: HomeRound[];
  /** Latest confirmed Grand Prix result + podium. */
  latestResult: { round: HomeRound; winner: MarbleIdentity | null; podium: MarbleIdentity[] } | null;
  leaderboard: LandingLeaderboardEntry[];
  stats: LandingStats;
}

// Homepage shows a fuller leaderboard now that it lives in a height-bounded,
// expandable panel — no longer just a top-5 teaser. Cap kept sane to bound the
// public payload.
function mapLeaderboard(rows: unknown): LandingLeaderboardEntry[] {
  return ((rows as Array<Record<string, unknown>>) ?? []).slice(0, 50).map((row) => ({
    userId: row.user_id as string,
    displayName: row.display_name as string,
    username: (row.username as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    correctCount: (row.correct_count as number) ?? 0,
    totalCount: (row.total_count as number) ?? 0,
    rank: (row.rank as number) ?? 0,
  }));
}

// Distinct marble identities across a championship's races (competitors attach
// to races, never directly to a competition).
async function loadMarbles(
  admin: ReturnType<typeof createAdminClient>,
  raceIds: string[],
): Promise<Map<string, MarbleIdentity>> {
  const map = new Map<string, MarbleIdentity>();
  if (raceIds.length === 0) return map;
  const { data } = await admin
    .from("race_competitors")
    .select("competitor_id, competitors ( id, name, number, colors, image_url )")
    .in("race_id", raceIds)
    .not("competitor_id", "is", null);
  for (const row of (data ?? []) as Array<{ competitors: unknown }>) {
    const c = row.competitors as { id: string; name: string | null; number: string | null; colors: string[] | null; image_url: string | null } | null;
    if (c && !map.has(c.id)) {
      map.set(c.id, { id: c.id, name: c.name, number: c.number, colors: c.colors ?? [], imageUrl: c.image_url });
    }
  }
  return map;
}

export async function getHomepageData(): Promise<HomepageData> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const [
    { count: betaTesters },
    { count: predictionsMade },
    { count: poolsCompleted },
    { data: leaderboardRows },
    { data: champRows },
    { data: practicePools },
  ] = await Promise.all([
    admin.from("user_profiles").select("id", { count: "exact", head: true }).eq("role", "player").eq("is_active", true),
    admin.from("entries").select("id", { count: "exact", head: true }),
    admin.from("pools").select("id", { count: "exact", head: true }).eq("status", "SETTLED"),
    admin.rpc("get_leaderboard", { p_scope: "global", p_range: "all_time", p_caller_id: NIL_UUID }),
    admin
      .from("racing_competitions")
      .select("id, name, image_url, status")
      .eq("format", "CHAMPIONSHIP")
      .neq("status", "CANCELLED")
      .order("created_at", { ascending: false }),
    // Today's Practice Race: an open free Single-Race (RACE_WINNER) pool.
    admin
      .from("pools")
      .select("*")
      .eq("status", "OPEN")
      .eq("stakes", "FREE")
      .eq("template_id", "RACE_WINNER")
      .gt("locks_at", nowIso)
      .order("locks_at", { ascending: true })
      .limit(1),
  ]);

  const stats: LandingStats = {
    betaTesters: betaTesters ?? 0,
    predictionsMade: predictionsMade ?? 0,
    poolsCompleted: poolsCompleted ?? 0,
  };
  const leaderboard = mapLeaderboard(leaderboardRows);
  const practiceRace = practicePools?.[0] ? await buildPublicViewModel(admin, practicePools[0]) : null;

  const championships = (champRows ?? []) as Array<{ id: string; name: string; image_url: string | null; status: string }>;
  const champ = championships.find((c) => c.status === "ACTIVE") ?? championships[0] ?? null;

  const empty: HomepageData = {
    championship: null,
    nextGrandPrix: null,
    grandPrixPool: null,
    practiceRace,
    standings: [],
    grid: [],
    upcomingRounds: [],
    latestResult: null,
    leaderboard,
    stats,
  };
  if (!champ) return empty;

  const { data: raceRows } = await admin
    .from("races")
    .select("id, title, race_number, scheduled_start_utc, status")
    .eq("competition_id", champ.id)
    .neq("status", "CANCELLED")
    .neq("status", "ABANDONED");
  const races = (raceRows ?? []) as Array<{ id: string; title: string | null; race_number: number | null; scheduled_start_utc: string | null; status: string }>;
  const raceIds = races.map((r) => r.id);

  const [standingsResult, marbleMap, confirmed] = await Promise.all([
    computeStandings(admin, champ.id),
    loadMarbles(admin, raceIds),
    raceIds.length
      ? admin.from("race_results").select("race_id, winner_competitor_id").in("race_id", raceIds).eq("status", "CONFIRMED")
      : Promise.resolve({ data: [] as Array<{ race_id: string; winner_competitor_id: string }> }),
  ]);
  const winnerByRace = new Map(
    ((confirmed.data ?? []) as Array<{ race_id: string; winner_competitor_id: string }>).map((r) => [r.race_id, r.winner_competitor_id]),
  );

  const toRound = (r: (typeof races)[number]): HomeRound => ({
    raceId: r.id,
    title: r.title ?? "Race",
    roundNumber: r.race_number,
    scheduledStartUtc: r.scheduled_start_utc,
    status: r.status,
    winner: winnerByRace.has(r.id) ? (marbleMap.get(winnerByRace.get(r.id)!) ?? null) : null,
  });

  const byStart = (a: (typeof races)[number], b: (typeof races)[number]) =>
    (a.scheduled_start_utc ?? "").localeCompare(b.scheduled_start_utc ?? "") ||
    (a.race_number ?? 0) - (b.race_number ?? 0);

  const scheduled = races.filter((r) => r.status === "SCHEDULED").sort(byStart);
  const futureScheduled = scheduled.filter((r) => r.scheduled_start_utc && r.scheduled_start_utc > nowIso);
  const upcomingPool = futureScheduled.length ? futureScheduled : scheduled;
  const nextRace = upcomingPool[0] ?? null;
  const nextGrandPrix = nextRace ? toRound(nextRace) : null;
  const upcomingRounds = upcomingPool.slice(0, 5).map(toRound);

  // Latest confirmed result (most recent by scheduled start).
  const resultRaces = races.filter((r) => winnerByRace.has(r.id)).sort((a, b) => byStart(b, a));
  let latestResult: HomepageData["latestResult"] = null;
  if (resultRaces[0]) {
    const view = await getRaceResultView(resultRaces[0].id);
    const podium: MarbleIdentity[] = view.order
      .filter((o) => o.finishStatus === "FINISHED" && o.position != null && o.position <= 3)
      .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
      .map((o) => ({ id: "", name: o.competitor.name ?? null, number: o.competitor.number ?? null, colors: o.competitor.colors ?? [], imageUrl: o.competitor.imageUrl ?? null }));
    latestResult = {
      round: toRound(resultRaces[0]),
      winner: marbleMap.get(winnerByRace.get(resultRaces[0].id)!) ?? null,
      podium,
    };
  }

  // Standings rows + full grid (standings first, then any marble not yet scored).
  const leaderPoints = standingsResult.rows[0]?.points ?? 0;
  const scoredRows: HomeStandingRow[] = standingsResult.rows.map((row) => ({
    position: row.rank,
    marble: marbleMap.get(row.competitorId) ?? { id: row.competitorId, name: "Marble", number: null, colors: [], imageUrl: null },
    points: row.points,
    wins: row.wins,
    gapToLeader: leaderPoints - row.points,
  }));
  const scoredIds = new Set(scoredRows.map((r) => r.marble.id));
  const unscored: HomeStandingRow[] = [...marbleMap.values()]
    .filter((m) => !scoredIds.has(m.id))
    .sort((a, b) => (a.number ?? "").localeCompare(b.number ?? "") || (a.name ?? "").localeCompare(b.name ?? ""))
    .map((marble) => ({ position: null, marble, points: 0, wins: 0, gapToLeader: leaderPoints }));
  const grid = [...scoredRows, ...unscored];
  const standings = scoredRows.slice(0, 5);

  // Grand Prix entry pool: the next round's cash pool, else the championship-winner cash pool.
  let grandPrixPool: SocialPoolCardViewModel | null = null;
  if (nextRace) {
    const { data } = await admin.from("pools").select("*").eq("race_id", nextRace.id).eq("stakes", "CASH").eq("status", "OPEN").limit(1);
    grandPrixPool = data?.[0] ? await buildPublicViewModel(admin, data[0]) : null;
  }
  if (!grandPrixPool) {
    const { data } = await admin
      .from("pools")
      .select("*")
      .eq("template_id", "COMPETITION_WINNER")
      .eq("template_config->>competition_id", champ.id)
      .eq("stakes", "CASH")
      .eq("status", "OPEN")
      .limit(1);
    grandPrixPool = data?.[0] ? await buildPublicViewModel(admin, data[0]) : null;
  }

  return {
    championship: { id: champ.id, name: champ.name, imageUrl: champ.image_url, status: champ.status },
    nextGrandPrix,
    grandPrixPool,
    practiceRace,
    standings,
    grid,
    upcomingRounds,
    latestResult,
    leaderboard,
    stats,
  };
}

// The real /analytics page's "Account balance" chart and MetricCard row,
// reconstructed for one real player instead of the visitor viewing their
// own — pre-login there's no session to scope to, so this uses the
// leaderboard's #1 player (real tiebreakers already applied by
// get_leaderboard) and reads the same source data those pages read.
// get_user_bankroll_balance/get_profile_stats are auth.uid()-scoped (no
// user-id parameter — see supabase/migrations/20260101000067), so they
// can't be called for an arbitrary user via the admin client; this
// mirrors get_user_bankroll_balance's own logic directly (opening balance
// = last balance_after before the range, then every wallet_transactions
// row's balance_after after that) rather than reinventing it.
async function getSampleUserAnalytics(
  admin: ReturnType<typeof createAdminClient>,
  topUser: LandingLeaderboardEntry,
): Promise<LandingSampleAnalytics> {
  const [{ count: poolsEntered }, { data: profile }, { data: balanceRows }] = await Promise.all([
    admin
      .from("entries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", topUser.userId),
    admin.from("user_profiles").select("current_streak").eq("id", topUser.userId).single(),
    admin
      .from("wallet_transactions")
      .select("created_at, balance_after")
      .eq("user_id", topUser.userId)
      .eq("account_type", "user")
      .order("created_at", { ascending: true }),
  ]);

  const balancePoints: LandingActivityPoint[] = (balanceRows ?? []).map((row) => ({
    timestamp: row.created_at as string,
    value: row.balance_after as number,
  }));

  return {
    displayName: topUser.displayName,
    poolsEntered: poolsEntered ?? 0,
    currentStreak: profile?.current_streak ?? 0,
    predictionAccuracy: { correct: topUser.correctCount, total: topUser.totalCount },
    balancePoints,
  };
}

async function getRecentActivity(
  admin: ReturnType<typeof createAdminClient>,
): Promise<LandingActivityItem[]> {
  const { data: entries } = await admin
    .from("entries")
    .select("id, created_at, pool_id, option_id, user_id")
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false })
    .limit(30);

  if (!entries || entries.length === 0) return [];

  const poolIds = [...new Set(entries.map((e) => e.pool_id as string))];
  const userIds = [...new Set(entries.map((e) => e.user_id as string))];
  const optionIds = [...new Set(entries.map((e) => e.option_id as string))];

  const [{ data: pools }, { data: users }, { data: options }] = await Promise.all([
    admin.from("pools").select("id, question, visibility, participation_visibility").in("id", poolIds),
    admin.from("user_profiles").select("id, display_name").in("id", userIds).eq("is_active", true),
    admin.from("pool_options").select("id, label").in("id", optionIds),
  ]);

  const poolById = new Map((pools ?? []).map((p) => [p.id, p]));
  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  const optionById = new Map((options ?? []).map((o) => [o.id, o]));

  const items: LandingActivityItem[] = [];
  for (const entry of entries) {
    const pool = poolById.get(entry.pool_id as string);
    const user = userById.get(entry.user_id as string);
    const option = optionById.get(entry.option_id as string);
    if (!pool || !user || !option) continue;
    if (pool.visibility !== "VISIBLE_TO_ALL_MEMBERS" || pool.participation_visibility !== "SHOW_BEFORE_ENTRY") {
      continue;
    }

    items.push({
      id: entry.id as string,
      text: `${user.display_name} picked ${option.label}`,
      createdAt: entry.created_at as string,
    });
    if (items.length === 5) break;
  }

  return items;
}
