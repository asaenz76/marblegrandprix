/**
 * Integration tests for Phase 6 — result confirmation -> grading -> automatic
 * settlement. Money-integrity: exact wallet math via the EXISTING settlement
 * RPCs (no payout math in TS). Covers normal payout, all-winner refund,
 * no-winner refund, exceptions, idempotency, and the Competition Winner adapter.
 * Run with: pnpm test:integration (local, guard-enforced).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createRacingPoolForActor } from "@/lib/racing/create-racing-pool";
import { recordRaceResultForActor, confirmRaceResultForActor, correctRaceResultForActor } from "@/lib/racing/race-result";
import { settleRacePool, type SettleRacePoolOutcome } from "@/lib/racing/settle-race-pool";
import type { RacingPoolRow } from "@/lib/racing/grade-race-pool";
import type { UserProfile } from "@/lib/auth/session";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const admin = createSupabaseClient(URL, SR, { auth: { autoRefreshToken: false, persistSession: false } });

type Role = "super_admin" | "admin" | "organizer" | "player";
const prof = (id: string, role: Role): UserProfile => ({ id, display_name: "t", username: null, avatar_url: null, role, is_active: true });

async function makeUser(role: Role, balanceCents = 0) {
  const email = `settle-${role}-${randomUUID().slice(0, 8)}@example.com`;
  const { data } = await admin.auth.admin.createUser({ email, password: "test-password-123", email_confirm: true });
  const id = data!.user!.id;
  await admin.from("user_profiles").insert({ id, display_name: role, role, is_active: true });
  if (balanceCents > 0) {
    await admin.rpc("apply_wallet_transaction", { p_account_type: "user", p_user_id: id, p_type: "manual_deposit", p_direction: "credit", p_amount: balanceCents, p_admin_id: null, p_reason: "seed", p_idempotency_key: randomUUID() });
  }
  return prof(id, role);
}
const balance = async (id: string) => (await admin.from("wallet_balances").select("balance").eq("user_id", id).single()).data!.balance as number;

let sa: UserProfile;

/** Build competition + race + N competitors + a Race Winner pool. Returns the
 *  pool id and a map from a label ("#1".."#N") to that option id. */
async function raceWinnerPool(n: number, entryFee = 1000, houseFeeBps = 0) {
  const comp = (await admin.from("racing_competitions").insert({ name: `C-${randomUUID().slice(0, 6)}`, format: "SINGLE_RACE" }).select("id").single()).data!;
  const race = (await admin.from("races").insert({ competition_id: comp.id, title: "R", status: "SCHEDULED" }).select("id").single()).data!;
  const competitorIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = (await admin.from("competitors").insert({ number: `#${i + 1}`, is_persistent: false, created_for_race_id: race.id }).select("id").single()).data!;
    competitorIds.push(c.id);
    await admin.from("race_competitors").insert({ race_id: race.id, competitor_id: c.id, sort_order: i });
  }
  const res = await createRacingPoolForActor(admin, sa, { scope: "RACE", raceId: race.id, entryFeeCents: entryFee, houseFeeBps, locksAt: "2035-01-01T00:00:00Z" });
  if (res.error) throw new Error(res.error);
  const opts = (await admin.from("pool_options").select("id, competitor_id").eq("pool_id", res.poolId!)).data!;
  const optByCompetitor = new Map(opts.map((o) => [o.competitor_id as string, o.id as string]));
  return { competitionId: comp.id, raceId: race.id, competitorIds, poolId: res.poolId!, optByCompetitor };
}

const enter = (poolId: string, userId: string, optionId: string, amount = 1000) =>
  admin.rpc("create_pool_entry", { p_pool_id: poolId, p_user_id: userId, p_option_id: optionId, p_amount: amount, p_idempotency_key: randomUUID() });

async function confirmWinner(raceId: string, winnerCompetitorId: string, actor = sa) {
  const rec = await recordRaceResultForActor(admin, actor, { raceId, winnerCompetitorId });
  if (rec.error) return { error: rec.error };
  return confirmRaceResultForActor(admin, actor, { raceId, resultId: rec.resultId! });
}

describe.skipIf(!SR)("Phase 6 — result confirmation -> grading -> settlement", () => {
  beforeAll(async () => { sa = await makeUser("super_admin"); });

  // ---- §24 NORMAL PAYOUT -------------------------------------------------
  it("normal: 4 competitors, 2 winners share the net pool, losers not credited, pool SETTLED", async () => {
    const { raceId, competitorIds, poolId, optByCompetitor } = await raceWinnerPool(4, 1000, 1000); // 10% fee
    const A = await makeUser("player", 5000), B = await makeUser("player", 5000), C = await makeUser("player", 5000), D = await makeUser("player", 5000);
    const red = optByCompetitor.get(competitorIds[0])!, blue = optByCompetitor.get(competitorIds[1])!, green = optByCompetitor.get(competitorIds[2])!;
    await enter(poolId, A.id, red); await enter(poolId, B.id, red); await enter(poolId, C.id, blue); await enter(poolId, D.id, green);
    // each debited 1000 -> 4000
    expect(await balance(A.id)).toBe(4000);

    const r = await confirmWinner(raceId, competitorIds[0]); // Red wins
    expect(r.error).toBeNull();
    expect(Object.values(r.outcomes!)[0]).toBe<SettleRacePoolOutcome>("settled");

    // gross=4000, fee=400 (10%), net=3600, winners=2, payout=1800 each
    expect(await balance(A.id)).toBe(5800); // 4000 + 1800
    expect(await balance(B.id)).toBe(5800);
    expect(await balance(C.id)).toBe(4000); // loser, no credit
    expect(await balance(D.id)).toBe(4000);
    const pool = (await admin.from("pools").select("status").eq("id", poolId).single()).data!;
    expect(pool.status).toBe("SETTLED");
    const winFlag = (await admin.from("pool_options").select("competitor_id").eq("pool_id", poolId).eq("is_winning_option", true)).data!;
    expect(winFlag).toEqual([{ competitor_id: competitorIds[0] }]);
    // notifications generated for participants (settlement notices)
    const notifs = (await admin.from("notifications").select("id").in("user_id", [A.id, C.id])).data ?? [];
    expect(notifs.length).toBeGreaterThan(0);
  });

  // ---- §25 ALL WIN -> REFUND, NO FEE ------------------------------------
  it("all-winner: everyone picks the winner -> all refunded, no fee", async () => {
    const { raceId, competitorIds, poolId, optByCompetitor } = await raceWinnerPool(4, 1000, 1000);
    const A = await makeUser("player", 5000), B = await makeUser("player", 5000), C = await makeUser("player", 5000);
    const red = optByCompetitor.get(competitorIds[0])!;
    await enter(poolId, A.id, red); await enter(poolId, B.id, red); await enter(poolId, C.id, red);
    const r = await confirmWinner(raceId, competitorIds[0]);
    expect(Object.values(r.outcomes!)[0]).toBe<SettleRacePoolOutcome>("refunded");
    expect(await balance(A.id)).toBe(5000); // fully refunded, no fee
    expect(await balance(B.id)).toBe(5000);
    expect(await balance(C.id)).toBe(5000);
  });

  // ---- §26 NOBODY WINS -> REFUND, NO FEE --------------------------------
  it("no-winner: nobody picked the winner -> all refunded, no fee", async () => {
    const { raceId, competitorIds, poolId, optByCompetitor } = await raceWinnerPool(4, 1000, 1000);
    const A = await makeUser("player", 5000), B = await makeUser("player", 5000);
    const blue = optByCompetitor.get(competitorIds[1])!, green = optByCompetitor.get(competitorIds[2])!;
    await enter(poolId, A.id, blue); await enter(poolId, B.id, green);
    const r = await confirmWinner(raceId, competitorIds[0]); // Red wins, nobody picked Red
    expect(Object.values(r.outcomes!)[0]).toBe<SettleRacePoolOutcome>("refunded");
    expect(await balance(A.id)).toBe(5000);
    expect(await balance(B.id)).toBe(5000);
  });

  // ---- §27 EXCEPTIONS ---------------------------------------------------
  it("DRAFT result (never confirmed) -> no settlement, no money moves", async () => {
    const { raceId, competitorIds, poolId, optByCompetitor } = await raceWinnerPool(3, 1000, 0);
    const A = await makeUser("player", 5000);
    await enter(poolId, A.id, optByCompetitor.get(competitorIds[0])!);
    await recordRaceResultForActor(admin, sa, { raceId, winnerCompetitorId: competitorIds[0] }); // DRAFT only, not confirmed
    const { data: pools } = await admin.from("pools").select("id, template_id, template_version, race_id, template_config, status").eq("id", poolId).single();
    expect((await settleRacePool(admin, pools as RacingPoolRow))).toBe<SettleRacePoolOutcome>("pending");
    expect(await balance(A.id)).toBe(4000); // entry only, no settlement
    expect((await admin.from("pools").select("status").eq("id", poolId).single()).data!.status).not.toBe("SETTLED");
  });

  it("dead heat -> manual review, no money", async () => {
    const { raceId, competitorIds, poolId, optByCompetitor } = await raceWinnerPool(3, 1000, 0);
    const A = await makeUser("player", 5000);
    await enter(poolId, A.id, optByCompetitor.get(competitorIds[0])!);
    const rec = await recordRaceResultForActor(admin, sa, { raceId, winnerCompetitorId: competitorIds[0], positions: [{ competitorId: competitorIds[0], position: 1 }, { competitorId: competitorIds[1], position: 1 }] });
    const r = await confirmRaceResultForActor(admin, sa, { raceId, resultId: rec.resultId! });
    expect(Object.values(r.outcomes!)[0]).toBe<SettleRacePoolOutcome>("manualReview");
    expect(await balance(A.id)).toBe(4000);
    expect((await admin.from("pools").select("status").eq("id", poolId).single()).data!.status).toBe("MANUAL_REVIEW");
  });

  it("winner not represented among pool options -> manual review, no money", async () => {
    const { raceId, competitorIds, poolId, optByCompetitor } = await raceWinnerPool(3, 1000, 0);
    const A = await makeUser("player", 5000);
    await enter(poolId, A.id, optByCompetitor.get(competitorIds[1])!);
    await admin.from("pool_options").delete().eq("pool_id", poolId).eq("competitor_id", competitorIds[0]); // remove winner's option
    const r = await confirmWinner(raceId, competitorIds[0]);
    expect(Object.values(r.outcomes!)[0]).toBe<SettleRacePoolOutcome>("manualReview");
    expect(await balance(A.id)).toBe(4000);
  });

  it("unauthorized actors (player, wrong-competition organizer, legacy admin) cannot confirm", async () => {
    const { raceId, competitorIds } = await raceWinnerPool(2, 1000, 0);
    const player = await makeUser("player");
    const orgOther = await makeUser("organizer"); // assigned to nothing
    const legacy = await makeUser("admin");
    for (const bad of [player, orgOther, legacy]) {
      const rec = await recordRaceResultForActor(admin, bad, { raceId, winnerCompetitorId: competitorIds[0] });
      expect(rec.error).not.toBeNull();
    }
  });

  // ---- §28 IDEMPOTENCY --------------------------------------------------
  it("confirming/settling the same result twice yields ONE financial outcome", async () => {
    const { raceId, competitorIds, poolId, optByCompetitor } = await raceWinnerPool(3, 1000, 0);
    const A = await makeUser("player", 5000), B = await makeUser("player", 5000);
    await enter(poolId, A.id, optByCompetitor.get(competitorIds[0])!); // A -> winner
    await enter(poolId, B.id, optByCompetitor.get(competitorIds[1])!); // B -> loser
    const rec = await recordRaceResultForActor(admin, sa, { raceId, winnerCompetitorId: competitorIds[0] });
    await confirmRaceResultForActor(admin, sa, { raceId, resultId: rec.resultId! });
    const aAfterFirst = await balance(A.id);
    // run confirmation + settlement again (retry)
    await confirmRaceResultForActor(admin, sa, { raceId, resultId: rec.resultId! });
    const { data: pool } = await admin.from("pools").select("id, template_id, template_version, race_id, template_config, status").eq("id", poolId).single();
    await settleRacePool(admin, pool as RacingPoolRow);
    expect(await balance(A.id)).toBe(aAfterFirst); // no double credit
    const { count } = await admin.from("race_grading_evidence").select("*", { count: "exact", head: true }).eq("pool_id", poolId);
    expect(count).toBe(1);
    // exactly ONE settlement, and exactly the winner's single payout (no duplicates)
    const settlements = (await admin.from("settlements").select("id").eq("pool_id", poolId)).data ?? [];
    expect(settlements.length).toBe(1);
    const payouts = (await admin.from("settlement_payouts").select("id").eq("settlement_id", settlements[0].id)).data ?? [];
    expect(payouts.length).toBe(1);
  });

  // ---- §30 COMPETITION WINNER ADAPTER -----------------------------------
  it("Competition Winner: ACTIVE+winner -> no settle; COMPLETED+winner -> settles via the same adapter", async () => {
    const comp = (await admin.from("racing_competitions").insert({ name: `CW-${randomUUID().slice(0, 6)}`, format: "CHAMPIONSHIP" }).select("id").single()).data!;
    const race = (await admin.from("races").insert({ competition_id: comp.id, title: "R", status: "SCHEDULED" }).select("id").single()).data!;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) { const c = (await admin.from("competitors").insert({ number: `#${i + 1}`, is_persistent: false, created_for_race_id: race.id }).select("id").single()).data!; ids.push(c.id); await admin.from("race_competitors").insert({ race_id: race.id, competitor_id: c.id }); }
    const res = await createRacingPoolForActor(admin, sa, { scope: "COMPETITION", competitionId: comp.id, entryFeeCents: 1000, houseFeeBps: 0, locksAt: "2035-01-01T00:00:00Z" });
    const opts = (await admin.from("pool_options").select("id, competitor_id").eq("pool_id", res.poolId!)).data!;
    const A = await makeUser("player", 5000), B = await makeUser("player", 5000);
    await enter(res.poolId!, A.id, opts.find((o) => o.competitor_id === ids[0])!.id); // winner
    await enter(res.poolId!, B.id, opts.find((o) => o.competitor_id === ids[1])!.id); // loser
    const poolRow = async () => (await admin.from("pools").select("id, template_id, template_version, race_id, template_config, status").eq("id", res.poolId!).single()).data as RacingPoolRow;

    // ACTIVE + winner -> no settlement
    await admin.from("racing_competitions").update({ status: "ACTIVE", winner_competitor_id: ids[0] }).eq("id", comp.id);
    expect(await settleRacePool(admin, await poolRow())).toBe<SettleRacePoolOutcome>("pending");
    expect(await balance(A.id)).toBe(4000);

    // COMPLETED + winner -> settles. gross=2000, fee=0, net=2000, 1 winner (A),
    // payout=2000 -> A: 4000 (after entry) + 2000 = 6000; B (loser) stays 4000.
    await admin.from("racing_competitions").update({ status: "COMPLETED" }).eq("id", comp.id);
    expect(await settleRacePool(admin, await poolRow())).toBe<SettleRacePoolOutcome>("settled");
    expect(await balance(A.id)).toBe(6000);
    expect(await balance(B.id)).toBe(4000);
  });

  // ---- §29 CORRECTION / REVERSAL ---------------------------------------
  it("Super-Admin correction: reverse the settled result, supersede v1, confirm v2, re-settle once; history preserved", async () => {
    const { raceId, competitorIds, poolId, optByCompetitor } = await raceWinnerPool(3, 1000, 0);
    const A = await makeUser("player", 5000), B = await makeUser("player", 5000);
    await enter(poolId, A.id, optByCompetitor.get(competitorIds[0])!); // A -> Red
    await enter(poolId, B.id, optByCompetitor.get(competitorIds[1])!); // B -> Blue

    // v1: Red wins -> A paid out
    const v1rec = await recordRaceResultForActor(admin, sa, { raceId, winnerCompetitorId: competitorIds[0] });
    await confirmRaceResultForActor(admin, sa, { raceId, resultId: v1rec.resultId! });
    expect(await balance(A.id)).toBe(6000); // 4000 + 2000 payout
    expect(await balance(B.id)).toBe(4000);

    // Correction: Blue actually won
    const corr = await correctRaceResultForActor(admin, sa, { raceId, newWinnerCompetitorId: competitorIds[1], reason: "wrong winner recorded" });
    expect(corr.error).toBeNull();
    expect(Object.values(corr.outcomes!)[0]).toBe<SettleRacePoolOutcome>("settled");

    // Wallets: A's payout reversed, B now paid out
    expect(await balance(A.id)).toBe(4000); // reversed back to post-entry
    expect(await balance(B.id)).toBe(6000); // now the winner

    // History preserved: v1 SUPERSEDED, v2 CONFIRMED; both evidence rows exist
    const results = (await admin.from("race_results").select("status, revision_number").eq("race_id", raceId).order("revision_number")).data!;
    expect(results.map((r) => r.status)).toEqual(["SUPERSEDED", "CONFIRMED"]);
    const ev = (await admin.from("race_grading_evidence").select("winner_competitor_id").eq("pool_id", poolId)).data!;
    expect(ev.length).toBe(2); // v1 (Red) + v2 (Blue) evidence, both historical
    // Blue is the authoritative winning option now
    const winFlag = (await admin.from("pool_options").select("competitor_id").eq("pool_id", poolId).eq("is_winning_option", true)).data!;
    expect(winFlag).toEqual([{ competitor_id: competitorIds[1] }]);
  });

  it("an Organizer cannot correct a settled result (super-admin only)", async () => {
    const { raceId, competitorIds } = await raceWinnerPool(2, 1000, 0);
    const org = await makeUser("organizer");
    const r = await correctRaceResultForActor(admin, org, { raceId, newWinnerCompetitorId: competitorIds[1], reason: "x" });
    expect(r.error).not.toBeNull();
  });

  afterAll(async () => {
    // best-effort cleanup of racing rows (wallet_transactions are append-only and left as-is)
    await admin.from("race_grading_evidence").delete().not("id", "is", null);
    await admin.from("settlement_payouts").delete().not("id", "is", null);
    await admin.from("settlements").delete().not("id", "is", null);
    await admin.from("entries").delete().not("id", "is", null);
    await admin.from("pool_options").delete().not("id", "is", null);
    await admin.from("pools").delete().not("id", "is", null);
    await admin.from("race_result_positions").delete().not("id", "is", null);
    await admin.from("race_results").delete().not("id", "is", null);
    await admin.from("race_competitors").delete().not("id", "is", null);
    await admin.from("races").delete().not("id", "is", null);
    await admin.from("racing_competitions").delete().not("id", "is", null);
    await admin.from("competitors").delete().not("id", "is", null);
  });
});
