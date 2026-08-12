/**
 * Integration tests for Phase 7 — championship/league standings + competition
 * winner finalization. Standings are pure/deterministic (no money); finalization
 * publishes the authoritative winner and lets the EXISTING Phase 5 grading +
 * Phase 6 settlement path settle unchanged (no new payout math here).
 * Run with: pnpm test:integration (local, guard-enforced).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createRacingPoolForActor } from "@/lib/racing/create-racing-pool";
import { recordRaceResultForActor, confirmRaceResultForActor, correctRaceResultForActor, type RaceResultPositionInput } from "@/lib/racing/race-result";
import { computeStandings } from "@/lib/racing/standings";
import { finalizeCompetitionForActor, refinalizeCompetitionForActor } from "@/lib/racing/finalize-competition";
import { reconcileRacingSettlements } from "@/lib/racing/reconcile";
import type { UserProfile } from "@/lib/auth/session";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const admin = createSupabaseClient(URL, SR, { auth: { autoRefreshToken: false, persistSession: false } });

type Role = "super_admin" | "admin" | "organizer" | "player";
const prof = (id: string, role: Role): UserProfile => ({ id, display_name: "t", username: null, avatar_url: null, role, is_active: true });

async function makeUser(role: Role, balanceCents = 0) {
  const email = `stand-${role}-${randomUUID().slice(0, 8)}@example.com`;
  const { data } = await admin.auth.admin.createUser({ email, password: "test-password-123", email_confirm: true });
  const id = data!.user!.id;
  await admin.from("user_profiles").insert({ id, display_name: role, role, is_active: true });
  if (balanceCents > 0) {
    await admin.rpc("apply_wallet_transaction", { p_account_type: "user", p_user_id: id, p_type: "manual_deposit", p_direction: "credit", p_amount: balanceCents, p_admin_id: null, p_reason: "seed", p_idempotency_key: randomUUID() });
  }
  return prof(id, role);
}
const balance = async (id: string) => (await admin.from("wallet_balances").select("balance").eq("user_id", id).single()).data!.balance as number;
const poolStatus = async (poolId: string) => (await admin.from("pools").select("status").eq("id", poolId).single()).data!.status as string;
const compRow = async (id: string) => (await admin.from("racing_competitions").select("status, winner_competitor_id").eq("id", id).single()).data!;

let sa: UserProfile;

/** Build a standings competition with N persistent competitors and M races. */
async function championship(n: number, races: number, format: "CHAMPIONSHIP" | "LEAGUE" = "CHAMPIONSHIP") {
  const comp = (await admin.from("racing_competitions").insert({ name: `Champ-${randomUUID().slice(0, 6)}`, format, status: "ACTIVE" }).select("id").single()).data!;
  const competitorIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = (await admin.from("competitors").insert({ name: `M${i + 1}`, number: `#${i + 1}`, is_persistent: true }).select("id").single()).data!;
    competitorIds.push(c.id);
  }
  const raceIds: string[] = [];
  for (let j = 0; j < races; j++) {
    const r = (await admin.from("races").insert({ competition_id: comp.id, title: `R${j + 1}`, race_number: j + 1, status: "SCHEDULED" }).select("id").single()).data!;
    for (let i = 0; i < n; i++) await admin.from("race_competitors").insert({ race_id: r.id, competitor_id: competitorIds[i], sort_order: i });
    raceIds.push(r.id);
  }
  return { competitionId: comp.id, competitorIds, raceIds };
}

/** Record + confirm a result. positions omitted => winner-only. */
async function record(raceId: string, winnerId: string, positions?: RaceResultPositionInput[], actor = sa) {
  const rec = await recordRaceResultForActor(admin, actor, { raceId, winnerCompetitorId: winnerId, positions });
  if (rec.error) throw new Error(rec.error);
  const conf = await confirmRaceResultForActor(admin, actor, { raceId, resultId: rec.resultId! });
  if (conf.error) throw new Error(conf.error);
}
const fullOrder = (ordered: string[]): RaceResultPositionInput[] => ordered.map((competitorId, i) => ({ competitorId, position: i + 1 }));

async function competitionPool(competitionId: string, entryFee = 1000, houseFeeBps = 0) {
  const res = await createRacingPoolForActor(admin, sa, { scope: "COMPETITION", competitionId, entryFeeCents: entryFee, houseFeeBps, locksAt: "2035-01-01T00:00:00Z" });
  if (res.error) throw new Error(res.error);
  const opts = (await admin.from("pool_options").select("id, competitor_id").eq("pool_id", res.poolId!)).data!;
  return { poolId: res.poolId!, optByCompetitor: new Map(opts.map((o) => [o.competitor_id as string, o.id as string])) };
}
const enter = (poolId: string, userId: string, optionId: string, amount = 1000) =>
  admin.rpc("create_pool_entry", { p_pool_id: poolId, p_user_id: userId, p_option_id: optionId, p_amount: amount, p_idempotency_key: randomUUID() });

const pointsOf = (rows: { competitorId: string; points: number }[], id: string) => rows.find((r) => r.competitorId === id)?.points;

describe.skipIf(!SR)("Phase 7 — standings + competition winner finalization", () => {
  beforeAll(async () => { sa = await makeUser("super_admin"); });

  // ---- §25 DEFAULT POINTS ------------------------------------------------
  it("default points: exact 10/6/4 totals across two full-order races", async () => {
    const { competitionId, competitorIds, raceIds } = await championship(3, 2);
    const [A, B, C] = competitorIds;
    await record(raceIds[0], A, fullOrder([A, B, C])); // A10 B6 C4
    await record(raceIds[1], B, fullOrder([B, A, C])); // B10 A6 C4
    const s = await computeStandings(admin, competitionId);
    expect(pointsOf(s.rows, A)).toBe(16);
    expect(pointsOf(s.rows, B)).toBe(16);
    expect(pointsOf(s.rows, C)).toBe(8);
    expect(s.topTie).toBe(true); // 16 == 16 at the top
    expect(s.leaderCompetitorId).toBeNull();
  });

  // ---- §25 MULTIPLE RACES (cumulative) -----------------------------------
  it("cumulative points across three confirmed races", async () => {
    const { competitionId, competitorIds, raceIds } = await championship(2, 3);
    const [A, B] = competitorIds;
    await record(raceIds[0], A); // winner-only A10
    await record(raceIds[1], A); // A +10 => 20
    await record(raceIds[2], B); // B10
    const s = await computeStandings(admin, competitionId);
    expect(pointsOf(s.rows, A)).toBe(20);
    expect(pointsOf(s.rows, B)).toBe(10);
    expect(s.leaderCompetitorId).toBe(A);
  });

  // ---- §25 SUPERSEDED ----------------------------------------------------
  it("superseded revision: only the current confirmed result counts", async () => {
    const { competitionId, competitorIds, raceIds } = await championship(2, 1);
    const [A, B] = competitorIds;
    await record(raceIds[0], A); // v1 confirmed: A wins
    let s = await computeStandings(admin, competitionId);
    expect(pointsOf(s.rows, A)).toBe(10);
    // Correct to B (super-admin) — supersedes v1, confirms v2.
    const res = await correctRaceResultForActor(admin, sa, { raceId: raceIds[0], newWinnerCompetitorId: B, reason: "wrong winner entered" });
    expect(res.error).toBeNull();
    s = await computeStandings(admin, competitionId);
    expect(pointsOf(s.rows, B)).toBe(10);
    expect(s.rows.find((r) => r.competitorId === A)).toBeUndefined(); // A no longer scores
  });

  // ---- §5 WINNER-ONLY ----------------------------------------------------
  it("winner-only result awards only first-place points", async () => {
    const { competitionId, competitorIds, raceIds } = await championship(3, 1);
    const [A] = competitorIds;
    await record(raceIds[0], A); // no positions
    const s = await computeStandings(admin, competitionId);
    expect(pointsOf(s.rows, A)).toBe(10);
    expect(s.rows).toHaveLength(1); // only the winner scored
  });

  // ---- §6 PARTIAL ORDER --------------------------------------------------
  it("partial order awards only known positions", async () => {
    const { competitionId, competitorIds, raceIds } = await championship(4, 1);
    const [A, B, C, D] = competitorIds;
    await record(raceIds[0], A, fullOrder([A, B, C])); // D not placed
    const s = await computeStandings(admin, competitionId);
    expect(pointsOf(s.rows, A)).toBe(10);
    expect(pointsOf(s.rows, B)).toBe(6);
    expect(pointsOf(s.rows, C)).toBe(4);
    expect(s.rows.find((r) => r.competitorId === D)).toBeUndefined(); // no inferred last place
  });

  // ---- §7 DEAD HEAT ------------------------------------------------------
  it("dead-heat race produces ambiguous standings (no points awarded from it)", async () => {
    const { competitionId, competitorIds, raceIds } = await championship(3, 1);
    const [A, B, C] = competitorIds;
    // Two competitors share position 1 -> ambiguous points allocation.
    await record(raceIds[0], A, [
      { competitorId: A, position: 1 },
      { competitorId: B, position: 1 },
      { competitorId: C, position: 3 },
    ]);
    const s = await computeStandings(admin, competitionId);
    expect(s.ambiguous).toBe(true);
    expect(s.ambiguousRaceIds).toContain(raceIds[0]);
    expect(s.rows).toHaveLength(0); // nothing scored from an ambiguous race
  });

  // ---- §26 TIE: no auto winner, no settlement, no wallet movement --------
  it("tie at the top: finalize sets no winner and settles nothing", async () => {
    const { competitionId, competitorIds, raceIds } = await championship(2, 2);
    const [A, B] = competitorIds;
    await record(raceIds[0], A); // A10
    await record(raceIds[1], B); // B10 -> tie
    const { poolId, optByCompetitor } = await competitionPool(competitionId, 1000, 0);
    const P1 = await makeUser("player", 5000), P2 = await makeUser("player", 5000);
    await enter(poolId, P1.id, optByCompetitor.get(A)!); await enter(poolId, P2.id, optByCompetitor.get(B)!);
    expect(await balance(P1.id)).toBe(4000); expect(await balance(P2.id)).toBe(4000);

    const res = await finalizeCompetitionForActor(admin, sa, competitionId);
    expect(res.outcome).toBe("tied");
    const comp = await compRow(competitionId);
    expect(comp.winner_competitor_id).toBeNull();
    expect(comp.status).toBe("ACTIVE"); // unresolved, not COMPLETED
    expect(await poolStatus(poolId)).not.toBe("SETTLED");
    expect(await balance(P1.id)).toBe(4000); // no money moved
    expect(await balance(P2.id)).toBe(4000);
    const settlements = (await admin.from("settlements").select("id").eq("pool_id", poolId)).data ?? [];
    expect(settlements).toHaveLength(0);
  });

  // ---- §11 COMPLETION GATE ----------------------------------------------
  it("refuses to finalize while a race lacks a confirmed result", async () => {
    const { competitionId, competitorIds, raceIds } = await championship(2, 2);
    await record(raceIds[0], competitorIds[0]); // only race 1 confirmed
    const res = await finalizeCompetitionForActor(admin, sa, competitionId);
    expect(res.outcome).toBe("incomplete");
    expect((await compRow(competitionId)).status).toBe("ACTIVE");
  });

  // ---- §27 FINALIZATION -> existing settlement pays out ------------------
  it("unambiguous: finalize completes, sets winner, existing settlement pays out", async () => {
    const { competitionId, competitorIds, raceIds } = await championship(3, 2);
    const [A, B] = competitorIds;
    await record(raceIds[0], A, fullOrder(competitorIds)); // A10 B6 C4
    await record(raceIds[1], A, fullOrder(competitorIds)); // A20 B12 C8 -> champion A
    const { poolId, optByCompetitor } = await competitionPool(competitionId, 1000, 0);
    const P1 = await makeUser("player", 5000), P2 = await makeUser("player", 5000);
    await enter(poolId, P1.id, optByCompetitor.get(A)!); await enter(poolId, P2.id, optByCompetitor.get(B)!);

    const res = await finalizeCompetitionForActor(admin, sa, competitionId);
    expect(res.outcome).toBe("finalized");
    expect(res.winnerCompetitorId).toBe(A);
    const comp = await compRow(competitionId);
    expect(comp.status).toBe("COMPLETED");
    expect(comp.winner_competitor_id).toBe(A);
    expect(await poolStatus(poolId)).toBe("SETTLED");
    // gross 2000, fee 0, net 2000, single winner P1 (on A) -> payout 2000.
    expect(await balance(P1.id)).toBe(6000);
    expect(await balance(P2.id)).toBe(4000);
    const winFlag = (await admin.from("pool_options").select("competitor_id").eq("pool_id", poolId).eq("is_winning_option", true)).data!;
    expect(winFlag).toEqual([{ competitor_id: A }]);
  });

  // ---- §28 ORGANIZER AUTHORIZATION --------------------------------------
  it("finalization authority: assigned organizer yes; unassigned/player/legacy-admin no", async () => {
    const { competitionId, competitorIds, raceIds } = await championship(2, 1);
    const [A] = competitorIds;
    await record(raceIds[0], A); // A champion, complete + unambiguous

    const unassigned = await makeUser("organizer");
    const player = await makeUser("player");
    const legacy = await makeUser("admin");
    expect((await finalizeCompetitionForActor(admin, unassigned, competitionId)).outcome).toBe("unauthorized");
    expect((await finalizeCompetitionForActor(admin, player, competitionId)).outcome).toBe("unauthorized");
    expect((await finalizeCompetitionForActor(admin, legacy, competitionId)).outcome).toBe("unauthorized");
    expect((await compRow(competitionId)).status).toBe("ACTIVE"); // still unfinalized

    // Assigned organizer can finalize (system derives the winner; they don't pick it).
    const org = await makeUser("organizer");
    await admin.from("competition_organizers").insert({ competition_id: competitionId, organizer_id: org.id });
    const res = await finalizeCompetitionForActor(admin, org, competitionId);
    expect(res.outcome).toBe("finalized");
    expect((await compRow(competitionId)).winner_competitor_id).toBe(A);
  });

  // ---- §29 CORRECTION BEFORE SETTLEMENT ---------------------------------
  it("correction before finalization: standings recalc changes the champion", async () => {
    const { competitionId, competitorIds, raceIds } = await championship(2, 3);
    const [A, B] = competitorIds;
    await record(raceIds[0], A); await record(raceIds[1], B); await record(raceIds[2], A); // A20 B10
    expect((await computeStandings(admin, competitionId)).leaderCompetitorId).toBe(A);
    // Correct race 1 A->B: now B20 A10.
    const c = await correctRaceResultForActor(admin, sa, { raceId: raceIds[0], newWinnerCompetitorId: B, reason: "correction" });
    expect(c.error).toBeNull();
    const res = await finalizeCompetitionForActor(admin, sa, competitionId);
    expect(res.outcome).toBe("finalized");
    expect(res.winnerCompetitorId).toBe(B);
    const comp = await compRow(competitionId);
    expect(comp.winner_competitor_id).toBe(B);
  });

  // ---- §29 CORRECTION AFTER SETTLEMENT ----------------------------------
  it("correction after settlement: no silent rewrite; reversal path restores money", async () => {
    const { competitionId, competitorIds, raceIds } = await championship(2, 2);
    const [A, B] = competitorIds;
    await record(raceIds[0], A); await record(raceIds[1], A); // champion A
    const { poolId, optByCompetitor } = await competitionPool(competitionId, 1000, 0);
    const P1 = await makeUser("player", 5000), P2 = await makeUser("player", 5000);
    await enter(poolId, P1.id, optByCompetitor.get(A)!); await enter(poolId, P2.id, optByCompetitor.get(B)!);
    // Finalize + settle: A wins, P1 paid.
    expect((await finalizeCompetitionForActor(admin, sa, competitionId)).outcome).toBe("finalized");
    expect(await poolStatus(poolId)).toBe("SETTLED");
    expect(await balance(P1.id)).toBe(6000); expect(await balance(P2.id)).toBe(4000);

    // A second finalize must NOT silently rewrite the finalized competition.
    const again = await finalizeCompetitionForActor(admin, sa, competitionId);
    expect(again.outcome).toBe("alreadyFinal");
    expect((await compRow(competitionId)).winner_competitor_id).toBe(A);
    expect(await balance(P1.id)).toBe(6000); // unchanged

    // Correct both races A->B; competition/pool remain untouched by race corrections.
    await correctRaceResultForActor(admin, sa, { raceId: raceIds[0], newWinnerCompetitorId: B, reason: "fix" });
    await correctRaceResultForActor(admin, sa, { raceId: raceIds[1], newWinnerCompetitorId: B, reason: "fix" });
    expect(await poolStatus(poolId)).toBe("SETTLED"); // still settled to A until re-finalized

    // Super-Admin re-finalization reverses the settled pool (existing machinery),
    // publishes the corrected champion B, and routes the pool to manual review
    // (append-only evidence still names A) — money is never paid to a stale backer.
    const refi = await refinalizeCompetitionForActor(admin, sa, competitionId, "champion corrected");
    expect(refi.outcome).toBe("finalized");
    expect(refi.winnerCompetitorId).toBe(B);
    const comp = await compRow(competitionId);
    expect(comp.winner_competitor_id).toBe(B); // truthful corrected champion
    expect(await poolStatus(poolId)).toBe("MANUAL_REVIEW"); // routed to review, not auto re-settled
    expect(await balance(P1.id)).toBe(4000); // A backer reversed
    expect(await balance(P2.id)).toBe(4000); // B backer not (yet) paid -> no wrong/duplicate money

    // The reconcile cron fallback must NOT auto-re-settle a parked pool to the
    // stale winner — MANUAL_REVIEW is outside its non-terminal set.
    await reconcileRacingSettlements();
    expect(await poolStatus(poolId)).toBe("MANUAL_REVIEW");
    expect(await balance(P1.id)).toBe(4000);
    expect(await balance(P2.id)).toBe(4000);
  });

  // ---- LEAGUE uses the SAME engine --------------------------------------
  it("league format is scored by the same engine and finalizes identically", async () => {
    const { competitionId, competitorIds, raceIds } = await championship(2, 1, "LEAGUE");
    const [A] = competitorIds;
    await record(raceIds[0], A);
    const res = await finalizeCompetitionForActor(admin, sa, competitionId);
    expect(res.outcome).toBe("finalized");
    expect(res.winnerCompetitorId).toBe(A);
  });

  afterAll(async () => {
    // Best-effort: leave seeded fake-balance users; no destructive cleanup needed
    // for local runs (matches the racing-settlement suite's posture).
  });
});
