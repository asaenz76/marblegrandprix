/**
 * Integration tests for Phase 8 — knockout / single-elimination progression.
 * Progression changes competition STRUCTURE (which competitor occupies which
 * slot); it moves no money directly. The structurally-final winner is published
 * and the EXISTING Phase 5/6 Competition Winner settlement path resolves the pool
 * unchanged. Covers bracket advancement, position-based elimination, the
 * correction safety boundary, idempotency, authorization, and money-safety.
 * Run with: pnpm test:integration (local, guard-enforced).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createRaceForActor } from "@/lib/racing/create-race";
import { createRacingPoolForActor } from "@/lib/racing/create-racing-pool";
import { recordRaceResultForActor, confirmRaceResultForActor, correctRaceResultForActor, type RaceResultPositionInput } from "@/lib/racing/race-result";
import { reconcileRacingProgression } from "@/lib/racing/reconcile";
import type { CreateRaceInput } from "@/lib/validations/races";
import type { UserProfile } from "@/lib/auth/session";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const admin = createSupabaseClient(URL, SR, { auth: { autoRefreshToken: false, persistSession: false } });

type Role = "super_admin" | "admin" | "organizer" | "player";
const prof = (id: string, role: Role): UserProfile => ({ id, display_name: "t", username: null, avatar_url: null, role, is_active: true });

async function makeUser(role: Role, balanceCents = 0) {
  const email = `prog-${role}-${randomUUID().slice(0, 8)}@example.com`;
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
const slotsOf = async (raceId: string) =>
  (await admin.from("race_competitors").select("id, competitor_id, is_placeholder, source_race_id, source_rule, source_position").eq("race_id", raceId).order("sort_order")).data!;

let sa: UserProfile;

async function bracketCompetition(format: "BRACKET" | "ELIMINATION") {
  return (await admin.from("racing_competitions").insert({ name: `${format}-${randomUUID().slice(0, 6)}`, format, status: "ACTIVE" }).select("id").single()).data!.id as string;
}
async function competitor(name: string, number: string) {
  return (await admin.from("competitors").insert({ name, number, is_persistent: true }).select("id").single()).data!.id as string;
}
/** Author a race via the real Phase 4/8 creation path (tests placeholder authoring). */
async function race(competitionId: string, title: string, competitors: CreateRaceInput["competitors"]) {
  const res = await createRaceForActor(admin, sa, { competitionId, title, competitors });
  if (res.error) throw new Error(`${title}: ${res.error}`);
  return res.raceId!;
}
const real = (id: string) => ({ existingCompetitorId: id });
const fromWinner = (sourceRaceId: string) => ({ advancesFrom: { sourceRaceId, sourceRule: "WINNER" as const } });
const fromPosition = (sourceRaceId: string, sourcePosition: number) => ({ advancesFrom: { sourceRaceId, sourceRule: "POSITION" as const, sourcePosition } });

async function confirm(raceId: string, winnerId: string, positions?: RaceResultPositionInput[], actor = sa) {
  const rec = await recordRaceResultForActor(admin, actor, { raceId, winnerCompetitorId: winnerId, positions });
  if (rec.error) throw new Error(rec.error);
  return confirmRaceResultForActor(admin, actor, { raceId, resultId: rec.resultId! });
}
async function competitionPool(competitionId: string, entryFee = 1000, houseFeeBps = 0) {
  const res = await createRacingPoolForActor(admin, sa, { scope: "COMPETITION", competitionId, entryFeeCents: entryFee, houseFeeBps, locksAt: "2035-01-01T00:00:00Z" });
  if (res.error) throw new Error(res.error);
  const opts = (await admin.from("pool_options").select("id, competitor_id").eq("pool_id", res.poolId!)).data!;
  return { poolId: res.poolId!, optByCompetitor: new Map(opts.map((o) => [o.competitor_id as string, o.id as string])) };
}
const enter = (poolId: string, userId: string, optionId: string, amount = 1000) =>
  admin.rpc("create_pool_entry", { p_pool_id: poolId, p_user_id: userId, p_option_id: optionId, p_amount: amount, p_idempotency_key: randomUUID() });
const occupant = (slots: Awaited<ReturnType<typeof slotsOf>>, sourceRaceId: string) => slots.find((s) => s.source_race_id === sourceRaceId);

describe.skipIf(!SR)("Phase 8 — knockout / elimination progression", () => {
  beforeAll(async () => { sa = await makeUser("super_admin"); });

  // ---- §13 BRACKET end-to-end + money ------------------------------------
  it("bracket: semifinal winners fill the final; final winner completes competition and settles", async () => {
    const comp = await bracketCompetition("BRACKET");
    const [A, B, C, D] = [await competitor("A", "#1"), await competitor("B", "#2"), await competitor("C", "#3"), await competitor("D", "#4")];
    const semi1 = await race(comp, "Semifinal 1", [real(A), real(B)]);
    const semi2 = await race(comp, "Semifinal 2", [real(C), real(D)]);
    const final = await race(comp, "Final", [fromWinner(semi1), fromWinner(semi2)]);

    // Competition Winner pool: options are the 4 distinct competitors; back A and C.
    const { poolId, optByCompetitor } = await competitionPool(comp);
    const P1 = await makeUser("player", 5000), P2 = await makeUser("player", 5000);
    await enter(poolId, P1.id, optByCompetitor.get(A)!); await enter(poolId, P2.id, optByCompetitor.get(C)!);

    // Confirm semifinals -> the final's slots fill from the correct sources.
    await confirm(semi1, A);
    expect(occupant(await slotsOf(final), semi1)!.competitor_id).toBe(A);
    expect(await poolStatus(poolId)).not.toBe("SETTLED"); // no money yet — only the final settles
    await confirm(semi2, C);
    expect(occupant(await slotsOf(final), semi2)!.competitor_id).toBe(C);
    const finalSlots = await slotsOf(final);
    expect(finalSlots.every((s) => !s.is_placeholder)).toBe(true);

    // Confirm the final -> publish champion A -> existing settlement runs.
    const res = await confirm(final, A);
    expect(res.progression?.winnerPublished).toBe(A);
    const cr = await compRow(comp);
    expect(cr.status).toBe("COMPLETED");
    expect(cr.winner_competitor_id).toBe(A);
    expect(await poolStatus(poolId)).toBe("SETTLED");
    // gross 2000, fee 0, net 2000, single winner P1 (on A) -> payout 2000.
    expect(await balance(P1.id)).toBe(6000);
    expect(await balance(P2.id)).toBe(4000);
  });

  // ---- §13 BRACKET idempotency -------------------------------------------
  it("bracket: repeat processing does not duplicate advancement or money", async () => {
    const comp = await bracketCompetition("BRACKET");
    const [A, B, C, D] = [await competitor("A", "#1"), await competitor("B", "#2"), await competitor("C", "#3"), await competitor("D", "#4")];
    const semi1 = await race(comp, "S1", [real(A), real(B)]);
    const semi2 = await race(comp, "S2", [real(C), real(D)]);
    const final = await race(comp, "F", [fromWinner(semi1), fromWinner(semi2)]);
    const { poolId, optByCompetitor } = await competitionPool(comp);
    const P1 = await makeUser("player", 5000), P2 = await makeUser("player", 5000);
    await enter(poolId, P1.id, optByCompetitor.get(A)!); await enter(poolId, P2.id, optByCompetitor.get(C)!);
    await confirm(semi1, A); await confirm(semi2, C); await confirm(final, A);
    expect(await poolStatus(poolId)).toBe("SETTLED");
    expect(await balance(P1.id)).toBe(6000);

    // Re-run the whole progression reconcile repeatedly.
    await reconcileRacingProgression();
    await reconcileRacingProgression();
    const finalSlots = await slotsOf(final);
    expect(finalSlots).toHaveLength(2); // no duplicate advancement rows
    expect(new Set(finalSlots.map((s) => s.competitor_id))).toEqual(new Set([A, C]));
    expect((await compRow(comp)).winner_competitor_id).toBe(A);
    expect(await poolStatus(poolId)).toBe("SETTLED");
    expect(await balance(P1.id)).toBe(6000); // no double pay
    expect(await balance(P2.id)).toBe(4000);
    const settlements = (await admin.from("settlements").select("id").eq("pool_id", poolId)).data ?? [];
    expect(settlements).toHaveLength(1);
  });

  // ---- §13 ELIMINATION: explicit positions advance survivors -------------
  it("elimination: explicit top-4 positions advance the right survivors; others do not", async () => {
    const comp = await bracketCompetition("ELIMINATION");
    const M = [] as string[];
    for (let i = 1; i <= 6; i++) M.push(await competitor(`M${i}`, `#${i}`));
    const heat = await race(comp, "Qualifier", M.map(real));
    const final = await race(comp, "Final", [fromPosition(heat, 1), fromPosition(heat, 2), fromPosition(heat, 3), fromPosition(heat, 4)]);

    await confirm(heat, M[0], M.map((id, i) => ({ competitorId: id, position: i + 1 }))); // M1..M6 in order
    const finalOccupants = new Set((await slotsOf(final)).filter((s) => !s.is_placeholder).map((s) => s.competitor_id));
    expect(finalOccupants).toEqual(new Set([M[0], M[1], M[2], M[3]])); // top 4 advance
    expect(finalOccupants.has(M[4])).toBe(false); // 5th and 6th eliminated
    expect(finalOccupants.has(M[5])).toBe(false);
  });

  // ---- §13 ELIMINATION: partial order insufficient -> no progression -----
  it("elimination: partial finishing order does not advance the unknown positions", async () => {
    const comp = await bracketCompetition("ELIMINATION");
    const M = [] as string[];
    for (let i = 1; i <= 6; i++) M.push(await competitor(`M${i}`, `#${i}`));
    const heat = await race(comp, "Qualifier", M.map(real));
    const final = await race(comp, "Final", [fromPosition(heat, 1), fromPosition(heat, 2), fromPosition(heat, 3), fromPosition(heat, 4)]);

    // Only positions 1 and 2 are recorded.
    await confirm(heat, M[0], [{ competitorId: M[0], position: 1 }, { competitorId: M[1], position: 2 }]);
    const slots = await slotsOf(final);
    const filled = slots.filter((s) => !s.is_placeholder).map((s) => s.competitor_id);
    expect(new Set(filled)).toEqual(new Set([M[0], M[1]])); // P1, P2 filled
    expect(slots.filter((s) => s.is_placeholder && s.source_position === 3)).toHaveLength(1); // P3 still open
    expect(slots.filter((s) => s.is_placeholder && s.source_position === 4)).toHaveLength(1); // P4 still open
  });

  // ---- §13 ELIMINATION: dead heat at boundary -> no progression ----------
  it("elimination: a dead heat at the advancement boundary does not progress that slot", async () => {
    const comp = await bracketCompetition("ELIMINATION");
    const M = [] as string[];
    for (let i = 1; i <= 5; i++) M.push(await competitor(`M${i}`, `#${i}`));
    const heat = await race(comp, "Qualifier", M.map(real));
    const final = await race(comp, "Final", [fromPosition(heat, 1), fromPosition(heat, 2), fromPosition(heat, 3), fromPosition(heat, 4)]);

    // M4 and M5 tie for 4th — the top-4 boundary is ambiguous.
    await confirm(heat, M[0], [
      { competitorId: M[0], position: 1 }, { competitorId: M[1], position: 2 }, { competitorId: M[2], position: 3 },
      { competitorId: M[3], position: 4 }, { competitorId: M[4], position: 4 },
    ]);
    const slots = await slotsOf(final);
    expect(new Set(slots.filter((s) => !s.is_placeholder).map((s) => s.competitor_id))).toEqual(new Set([M[0], M[1], M[2]])); // P1..P3
    expect(slots.filter((s) => s.is_placeholder && s.source_position === 4)).toHaveLength(1); // boundary slot unresolved
  });

  // ---- §13 CORRECTION before downstream starts -> safe rebuild -----------
  it("correction: replaces a downstream slot while the downstream is still fully mutable", async () => {
    const comp = await bracketCompetition("BRACKET");
    const [A, B, C, D] = [await competitor("A", "#1"), await competitor("B", "#2"), await competitor("C", "#3"), await competitor("D", "#4")];
    const semi1 = await race(comp, "S1", [real(A), real(B)]);
    const semi2 = await race(comp, "S2", [real(C), real(D)]);
    const final = await race(comp, "F", [fromWinner(semi1), fromWinner(semi2)]);
    await confirm(semi1, A);
    expect(occupant(await slotsOf(final), semi1)!.competitor_id).toBe(A);

    const res = await correctRaceResultForActor(admin, sa, { raceId: semi1, newWinnerCompetitorId: B, reason: "wrong winner" });
    expect(res.error).toBeNull();
    expect(occupant(await slotsOf(final), semi1)!.competitor_id).toBe(B); // slot deterministically replaced
    // history preserved
    const revs = (await admin.from("race_results").select("status, winner_competitor_id").eq("race_id", semi1).order("revision_number")).data!;
    expect(revs.map((r) => r.status)).toEqual(["SUPERSEDED", "CONFIRMED"]);
  });

  // ---- §13 CORRECTION blocked after a downstream pool has entries --------
  it("correction: blocked when a downstream race carries a pool with entries (no cascade)", async () => {
    const comp = await bracketCompetition("BRACKET");
    const [A, B, C, D] = [await competitor("A", "#1"), await competitor("B", "#2"), await competitor("C", "#3"), await competitor("D", "#4")];
    const semi1 = await race(comp, "S1", [real(A), real(B)]);
    const semi2 = await race(comp, "S2", [real(C), real(D)]);
    const final = await race(comp, "F", [fromWinner(semi1), fromWinner(semi2)]);
    await confirm(semi1, A); await confirm(semi2, C); // final populated with A, C
    // A Race Winner pool on the final, with an entry -> final is no longer mutable.
    const fin = await createRacingPoolForActor(admin, sa, { scope: "RACE", raceId: final, entryFeeCents: 1000, houseFeeBps: 0, locksAt: "2035-01-01T00:00:00Z" });
    const finOpts = (await admin.from("pool_options").select("id, competitor_id").eq("pool_id", fin.poolId!)).data!;
    const backer = await makeUser("player", 5000);
    await enter(fin.poolId!, backer.id, finOpts.find((o) => o.competitor_id === A)!.id);

    const res = await correctRaceResultForActor(admin, sa, { raceId: semi1, newWinnerCompetitorId: B, reason: "too late" });
    expect(res.error).not.toBeNull();
    expect(res.blockedBy?.some((b) => b.raceId === final)).toBe(true); // dependency chain surfaced
    // Nothing changed: semi1 still A, final slot still A, no money moved.
    const revs = (await admin.from("race_results").select("status").eq("race_id", semi1)).data!;
    expect(revs).toHaveLength(1); // correction did not supersede
    expect(occupant(await slotsOf(final), semi1)!.competitor_id).toBe(A);
    expect(await balance(backer.id)).toBe(4000); // entry only; no reversal/cascade
  });

  // ---- §13 CORRECTION blocked after a downstream result is confirmed -----
  it("correction: blocked when a downstream race already has a confirmed result", async () => {
    const comp = await bracketCompetition("BRACKET");
    const [A, B, C, D] = [await competitor("A", "#1"), await competitor("B", "#2"), await competitor("C", "#3"), await competitor("D", "#4")];
    const semi1 = await race(comp, "S1", [real(A), real(B)]);
    const semi2 = await race(comp, "S2", [real(C), real(D)]);
    const final = await race(comp, "F", [fromWinner(semi1), fromWinner(semi2)]);
    await confirm(semi1, A); await confirm(semi2, C); await confirm(final, A); // whole bracket resolved

    const res = await correctRaceResultForActor(admin, sa, { raceId: semi1, newWinnerCompetitorId: B, reason: "nope" });
    expect(res.error).not.toBeNull();
    expect(res.blockedBy?.some((b) => b.raceId === final)).toBe(true);
    expect(occupant(await slotsOf(final), semi1)!.competitor_id).toBe(A); // unchanged
    expect((await compRow(comp)).winner_competitor_id).toBe(A); // champion not silently rewritten
  });

  // ---- §13 AUTH ----------------------------------------------------------
  it("authorization: assigned organizer can confirm (progression runs); others cannot record", async () => {
    const comp = await bracketCompetition("BRACKET");
    const [A, B, C, D] = [await competitor("A", "#1"), await competitor("B", "#2"), await competitor("C", "#3"), await competitor("D", "#4")];
    const semi1 = await race(comp, "S1", [real(A), real(B)]);
    const semi2 = await race(comp, "S2", [real(C), real(D)]);
    const final = await race(comp, "F", [fromWinner(semi1), fromWinner(semi2)]);

    const unassigned = await makeUser("organizer"), player = await makeUser("player"), legacy = await makeUser("admin");
    for (const bad of [unassigned, player, legacy]) {
      const rec = await recordRaceResultForActor(admin, bad, { raceId: semi1, winnerCompetitorId: A });
      expect(rec.error).not.toBeNull();
    }

    const org = await makeUser("organizer");
    await admin.from("competition_organizers").insert({ competition_id: comp, organizer_id: org.id });
    const out = await confirm(semi1, A, undefined, org); // assigned organizer confirms -> progression runs
    expect(out.error).toBeNull();
    expect(occupant(await slotsOf(final), semi1)!.competitor_id).toBe(A);
  });

  // ---- §13 MONEY: progression itself moves no money ----------------------
  it("money-safety: confirming a non-final race fills a slot but settles nothing", async () => {
    const comp = await bracketCompetition("BRACKET");
    const [A, B, C, D] = [await competitor("A", "#1"), await competitor("B", "#2"), await competitor("C", "#3"), await competitor("D", "#4")];
    const semi1 = await race(comp, "S1", [real(A), real(B)]);
    const semi2 = await race(comp, "S2", [real(C), real(D)]);
    await race(comp, "F", [fromWinner(semi1), fromWinner(semi2)]);
    const { poolId, optByCompetitor } = await competitionPool(comp);
    const P1 = await makeUser("player", 5000), P2 = await makeUser("player", 5000);
    await enter(poolId, P1.id, optByCompetitor.get(A)!); await enter(poolId, P2.id, optByCompetitor.get(C)!);

    await confirm(semi1, A); await confirm(semi2, C); // both semis done, final populated, NOT confirmed
    expect(await poolStatus(poolId)).not.toBe("SETTLED"); // competition not yet complete
    expect((await compRow(comp)).winner_competitor_id).toBeNull();
    expect(await balance(P1.id)).toBe(4000); // entry only, no payout
    expect(await balance(P2.id)).toBe(4000);
  });
});
