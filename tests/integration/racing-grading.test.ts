/**
 * Integration tests for Phase 5 — racing prediction templates & grading.
 * Covers RACE_WINNER / COMPETITION_WINNER pool creation (N options), grading
 * against the authoritative CONFIRMED result revision, revision handling,
 * ambiguity/manual-review, idempotency, and the no-settlement guarantee.
 * Run with: pnpm test:integration (local stack; guard-enforced).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createRacingPoolForActor } from "@/lib/racing/create-racing-pool";
import { gradeRacePool, type RacingPoolRow } from "@/lib/racing/grade-race-pool";
import type { UserProfile } from "@/lib/auth/session";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const admin = createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const superAdmin: UserProfile = { id: "", display_name: "sa", username: null, avatar_url: null, role: "super_admin", is_active: true };

async function bootstrapActor() {
  const email = `grading-sa-${randomUUID().slice(0, 8)}@example.com`;
  const { data } = await admin.auth.admin.createUser({ email, password: "test-password-123", email_confirm: true });
  await admin.from("user_profiles").insert({ id: data!.user!.id, display_name: "sa", role: "super_admin", is_active: true });
  superAdmin.id = data!.user!.id;
}

async function makeRace(nCompetitors: number) {
  const { data: comp } = await admin.from("racing_competitions").insert({ name: `C-${randomUUID().slice(0, 6)}`, format: "SINGLE_RACE" }).select("id").single();
  const { data: race } = await admin.from("races").insert({ competition_id: comp!.id, title: "R", status: "SCHEDULED" }).select("id").single();
  const competitorIds: string[] = [];
  for (let i = 0; i < nCompetitors; i++) {
    const { data: c } = await admin.from("competitors").insert({ number: `#${i + 1}`, is_persistent: false, created_for_race_id: race!.id }).select("id").single();
    competitorIds.push(c!.id);
    await admin.from("race_competitors").insert({ race_id: race!.id, competitor_id: c!.id, sort_order: i });
  }
  return { competitionId: comp!.id, raceId: race!.id, competitorIds };
}

async function poolRow(poolId: string): Promise<RacingPoolRow> {
  const { data } = await admin.from("pools").select("id, template_id, template_version, race_id, template_config").eq("id", poolId).single();
  return data as RacingPoolRow;
}

async function confirmResult(raceId: string, winnerId: string, opts: { revision?: number; positions?: Array<{ id: string; pos: number }> } = {}) {
  const { data: r } = await admin
    .from("race_results")
    .insert({ race_id: raceId, winner_competitor_id: winnerId, revision_number: opts.revision ?? 1, status: "CONFIRMED" })
    .select("id")
    .single();
  if (opts.positions) {
    await admin.from("race_result_positions").insert(opts.positions.map((p) => ({ race_result_id: r!.id, race_id: raceId, competitor_id: p.id, position: p.pos })));
  }
  return r!.id as string;
}

async function walletTxnCount() {
  const { count } = await admin.from("wallet_transactions").select("*", { count: "exact", head: true });
  return count ?? 0;
}
async function settlementCount() {
  const { count } = await admin.from("settlements").select("*", { count: "exact", head: true });
  return count ?? 0;
}

describe.skipIf(!SERVICE_ROLE_KEY)("Phase 5 — racing templates & grading", () => {
  beforeAll(bootstrapActor);

  // ---- RACE WINNER TEMPLATE / OPTION GENERATION --------------------------
  it("generates one option per competitor for 2 / 4 / 8 competitors, with competitor_id and no draw", async () => {
    for (const n of [2, 4, 8]) {
      const { raceId, competitorIds } = await makeRace(n);
      const res = await createRacingPoolForActor(admin, superAdmin, { scope: "RACE", raceId, entryFeeCents: 100, locksAt: "2030-01-01T00:00:00Z" });
      expect(res.error).toBeNull();
      const { data: opts } = await admin.from("pool_options").select("competitor_id, label").eq("pool_id", res.poolId!);
      expect(opts!.length).toBe(n);
      expect(new Set(opts!.map((o) => o.competitor_id)).size).toBe(n); // no duplicate competitor option
      expect(opts!.every((o) => competitorIds.includes(o.competitor_id as string))).toBe(true);
      expect(opts!.some((o) => o.label === "Draw")).toBe(false);
    }
  });

  it("rejects a Race Winner pool with fewer than 2 competitors", async () => {
    const { raceId } = await makeRace(1);
    const res = await createRacingPoolForActor(admin, superAdmin, { scope: "RACE", raceId, entryFeeCents: 100, locksAt: "2030-01-01T00:00:00Z" });
    expect(res.error).not.toBeNull();
  });

  // ---- RACE WINNER GRADING ----------------------------------------------
  it("grades the correct competitor's option from a confirmed winner-only result", async () => {
    const { raceId, competitorIds } = await makeRace(4);
    const { poolId } = await createRacingPoolForActor(admin, superAdmin, { scope: "RACE", raceId, entryFeeCents: 100, locksAt: "2030-01-01T00:00:00Z" });
    await confirmResult(raceId, competitorIds[2]); // competitor #3 wins

    const before = await walletTxnCount();
    const r = await gradeRacePool(admin, await poolRow(poolId!));
    expect(r.status).toBe("GRADED");
    expect(r.winnerCompetitorId).toBe(competitorIds[2]);

    // the winning option is exactly competitor #3's option
    const { data: winOpt } = await admin.from("pool_options").select("competitor_id").eq("id", r.winningOptionId!).single();
    expect(winOpt!.competitor_id).toBe(competitorIds[2]);
    const { data: flagged } = await admin.from("pool_options").select("competitor_id").eq("pool_id", poolId!).eq("is_winning_option", true);
    expect(flagged!.length).toBe(1);
    expect(flagged![0].competitor_id).toBe(competitorIds[2]);

    // NO money moved, NO settlement created
    expect(await walletTxnCount()).toBe(before);
    // evidence references the current result revision
    const { data: ev } = await admin.from("race_grading_evidence").select("result_revision_id, winner_competitor_id").eq("pool_id", poolId!).single();
    expect(ev!.result_revision_id).toBe(r.resultRevisionId);
    expect(ev!.winner_competitor_id).toBe(competitorIds[2]);
  });

  it("grades from a full finishing order too", async () => {
    const { raceId, competitorIds } = await makeRace(3);
    const { poolId } = await createRacingPoolForActor(admin, superAdmin, { scope: "RACE", raceId, entryFeeCents: 100, locksAt: "2030-01-01T00:00:00Z" });
    await confirmResult(raceId, competitorIds[0], { positions: competitorIds.map((id, i) => ({ id, pos: i + 1 })) });
    const r = await gradeRacePool(admin, await poolRow(poolId!));
    expect(r.status).toBe("GRADED");
    expect(r.winnerCompetitorId).toBe(competitorIds[0]);
  });

  it("uses the current CONFIRMED revision and ignores a SUPERSEDED one", async () => {
    const { raceId, competitorIds } = await makeRace(4);
    const { poolId } = await createRacingPoolForActor(admin, superAdmin, { scope: "RACE", raceId, entryFeeCents: 100, locksAt: "2030-01-01T00:00:00Z" });
    // v1 confirmed (winner #1), then superseded; v2 confirmed (winner #4)
    const v1 = await admin.from("race_results").insert({ race_id: raceId, winner_competitor_id: competitorIds[0], revision_number: 1, status: "CONFIRMED" }).select("id").single();
    await admin.from("race_results").update({ status: "SUPERSEDED" }).eq("id", v1.data!.id);
    await confirmResult(raceId, competitorIds[3], { revision: 2 });
    const r = await gradeRacePool(admin, await poolRow(poolId!));
    expect(r.status).toBe("GRADED");
    expect(r.winnerCompetitorId).toBe(competitorIds[3]); // v2, not v1
  });

  it("is PENDING when there is no confirmed result yet", async () => {
    const { raceId } = await makeRace(3);
    const { poolId } = await createRacingPoolForActor(admin, superAdmin, { scope: "RACE", raceId, entryFeeCents: 100, locksAt: "2030-01-01T00:00:00Z" });
    const r = await gradeRacePool(admin, await poolRow(poolId!));
    expect(r.status).toBe("PENDING");
  });

  it("routes a dead heat (shared position 1) to MANUAL_REVIEW without guessing", async () => {
    const { raceId, competitorIds } = await makeRace(3);
    const { poolId } = await createRacingPoolForActor(admin, superAdmin, { scope: "RACE", raceId, entryFeeCents: 100, locksAt: "2030-01-01T00:00:00Z" });
    // winner set, but two competitors share position 1 -> ambiguous
    await confirmResult(raceId, competitorIds[0], { positions: [{ id: competitorIds[0], pos: 1 }, { id: competitorIds[1], pos: 1 }] });
    const r = await gradeRacePool(admin, await poolRow(poolId!));
    expect(r.status).toBe("MANUAL_REVIEW");
    expect(r.reason).toBe("RACE_RESULT_UNRESOLVABLE");
    const { data: p } = await admin.from("pools").select("status, review_reason").eq("id", poolId!).single();
    expect(p!.status).toBe("MANUAL_REVIEW");
  });

  it("a clear single winner grades even with DNF/DSQ competitors elsewhere", async () => {
    const { raceId, competitorIds } = await makeRace(4);
    const { poolId } = await createRacingPoolForActor(admin, superAdmin, { scope: "RACE", raceId, entryFeeCents: 100, locksAt: "2030-01-01T00:00:00Z" });
    const rid = await confirmResult(raceId, competitorIds[0], { positions: [{ id: competitorIds[0], pos: 1 }] });
    await admin.from("race_result_positions").insert([
      { race_result_id: rid, race_id: raceId, competitor_id: competitorIds[1], position: null, finish_status: "DNF" },
      { race_result_id: rid, race_id: raceId, competitor_id: competitorIds[2], position: null, finish_status: "DSQ" },
    ]);
    const r = await gradeRacePool(admin, await poolRow(poolId!));
    expect(r.status).toBe("GRADED");
    expect(r.winnerCompetitorId).toBe(competitorIds[0]);
  });

  it("routes to MANUAL_REVIEW when the winner is not among the pool options", async () => {
    const { raceId, competitorIds } = await makeRace(3);
    const { poolId } = await createRacingPoolForActor(admin, superAdmin, { scope: "RACE", raceId, entryFeeCents: 100, locksAt: "2030-01-01T00:00:00Z" });
    // remove the winner's option, then confirm that competitor as winner
    await admin.from("pool_options").delete().eq("pool_id", poolId!).eq("competitor_id", competitorIds[0]);
    await confirmResult(raceId, competitorIds[0]);
    const r = await gradeRacePool(admin, await poolRow(poolId!));
    expect(r.status).toBe("MANUAL_REVIEW");
    expect(r.reason).toBe("WINNER_NOT_IN_POOL_OPTIONS");
  });

  it("is idempotent: repeated grading of the same result does not duplicate evidence or move money", async () => {
    const { raceId, competitorIds } = await makeRace(4);
    const { poolId } = await createRacingPoolForActor(admin, superAdmin, { scope: "RACE", raceId, entryFeeCents: 100, locksAt: "2030-01-01T00:00:00Z" });
    await confirmResult(raceId, competitorIds[1]);
    const s0 = await settlementCount();
    const r1 = await gradeRacePool(admin, await poolRow(poolId!));
    const r2 = await gradeRacePool(admin, await poolRow(poolId!));
    const r3 = await gradeRacePool(admin, await poolRow(poolId!));
    expect(r1.status).toBe("GRADED");
    expect(r2.status).toBe("ALREADY_GRADED");
    expect(r3.status).toBe("ALREADY_GRADED");
    expect([r1.winningOptionId, r2.winningOptionId, r3.winningOptionId].every((x) => x === r1.winningOptionId)).toBe(true);
    const { count } = await admin.from("race_grading_evidence").select("*", { count: "exact", head: true }).eq("pool_id", poolId!);
    expect(count).toBe(1);
    expect(await settlementCount()).toBe(s0); // no settlement created by grading
  });

  // ---- COMPETITION WINNER (finalization-gated) --------------------------
  async function competitionPool(n: number) {
    const { competitionId, competitorIds, raceId } = await makeRace(n);
    const res = await createRacingPoolForActor(admin, superAdmin, { scope: "COMPETITION", competitionId, entryFeeCents: 100, locksAt: "2030-01-01T00:00:00Z" });
    expect(res.error).toBeNull();
    return { competitionId, competitorIds, raceId, poolId: res.poolId! };
  }
  const setStatus = (competitionId: string, status: string) => admin.from("racing_competitions").update({ status }).eq("id", competitionId);
  const setWinner = (competitionId: string, winnerId: string | null) => admin.from("racing_competitions").update({ winner_competitor_id: winnerId }).eq("id", competitionId);

  it("generates one option per competition competitor", async () => {
    const { poolId } = await competitionPool(4);
    const { data: opts } = await admin.from("pool_options").select("competitor_id").eq("pool_id", poolId);
    expect(opts!.length).toBe(4);
  });

  it("ACTIVE competition with a provisional winner set -> PENDING (finalization required, does not grade)", async () => {
    const { competitionId, competitorIds, poolId } = await competitionPool(4);
    await setStatus(competitionId, "ACTIVE");
    await setWinner(competitionId, competitorIds[1]); // provisional winner on a non-final competition
    expect((await gradeRacePool(admin, await poolRow(poolId))).status).toBe("PENDING");
  });

  it("COMPLETED competition with no winner -> MANUAL_REVIEW (unresolved final state)", async () => {
    const { competitionId, poolId } = await competitionPool(3);
    await setStatus(competitionId, "COMPLETED");
    await setWinner(competitionId, null);
    const r = await gradeRacePool(admin, await poolRow(poolId));
    expect(r.status).toBe("MANUAL_REVIEW");
    expect(r.reason).toBe("RACE_RESULT_UNRESOLVABLE");
  });

  it("COMPLETED competition with a valid winner -> grades the correct option, no money moves", async () => {
    const { competitionId, competitorIds, poolId } = await competitionPool(4);
    const wt0 = await walletTxnCount();
    const s0 = await settlementCount();
    await setStatus(competitionId, "COMPLETED");
    await setWinner(competitionId, competitorIds[2]);
    const r = await gradeRacePool(admin, await poolRow(poolId));
    expect(r.status).toBe("GRADED");
    expect(r.winnerCompetitorId).toBe(competitorIds[2]);
    const won = (await admin.from("pool_options").select("competitor_id").eq("id", r.winningOptionId!).single()).data!;
    expect(won.competitor_id).toBe(competitorIds[2]);
    expect(await walletTxnCount()).toBe(wt0);
    expect(await settlementCount()).toBe(s0);
  });

  it("COMPLETED competition with winner not among options -> MANUAL_REVIEW", async () => {
    const { competitionId, raceId, poolId } = await competitionPool(3);
    const outsider = (await admin.from("competitors").insert({ name: "Outsider", is_persistent: false, created_for_race_id: raceId }).select("id").single()).data!;
    await setStatus(competitionId, "COMPLETED");
    await setWinner(competitionId, outsider.id);
    const r = await gradeRacePool(admin, await poolRow(poolId));
    expect(r.status).toBe("MANUAL_REVIEW");
    expect(r.reason).toBe("WINNER_NOT_IN_POOL_OPTIONS");
  });

  it("repeated Competition Winner grading is idempotent (no duplicate evidence, no settlement)", async () => {
    const { competitionId, competitorIds, poolId } = await competitionPool(4);
    const s0 = await settlementCount();
    await setStatus(competitionId, "COMPLETED");
    await setWinner(competitionId, competitorIds[0]);
    const r1 = await gradeRacePool(admin, await poolRow(poolId));
    const r2 = await gradeRacePool(admin, await poolRow(poolId));
    expect(r1.status).toBe("GRADED");
    expect(r2.status).toBe("ALREADY_GRADED");
    const { count } = await admin.from("race_grading_evidence").select("*", { count: "exact", head: true }).eq("pool_id", poolId);
    expect(count).toBe(1);
    expect(await settlementCount()).toBe(s0);
  });

  afterAll(async () => {
    await admin.from("race_grading_evidence").delete().not("id", "is", null);
    await admin.from("pool_options").delete().not("id", "is", null);
    await admin.from("pools").delete().not("id", "is", null);
    await admin.from("race_result_positions").delete().not("id", "is", null);
    await admin.from("race_results").delete().not("id", "is", null);
    await admin.from("race_competitors").delete().not("id", "is", null);
    await admin.from("racing_competitions").update({ winner_competitor_id: null }).not("id", "is", null);
    await admin.from("races").delete().not("id", "is", null);
    await admin.from("racing_competitions").delete().not("id", "is", null);
    await admin.from("competitors").delete().not("id", "is", null);
    if (superAdmin.id) await admin.from("user_profiles").update({ is_active: false }).eq("id", superAdmin.id);
  });
});
