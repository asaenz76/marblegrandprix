/**
 * Integration tests for Phase 17 — operator delete of racing competitions and
 * races. Money-integrity: a live entry is refunded through the EXISTING audited
 * path (void_pool_entry -> apply_wallet_transaction), so the player's balance is
 * made whole before teardown. Also covers the pre-lock guard, single-race
 * delete, and the Super-Admin authority gate. Run: pnpm test:integration.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createRacingPoolForActor } from "@/lib/racing/create-racing-pool";
import { deleteCompetitionForActor, deleteRaceForActor } from "@/lib/racing/delete-racing";
import type { UserProfile } from "@/lib/auth/session";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const admin = createSupabaseClient(URL, SR, { auth: { autoRefreshToken: false, persistSession: false } });

type Role = "super_admin" | "organizer" | "player";
const prof = (id: string, role: Role): UserProfile => ({ id, display_name: "t", username: null, avatar_url: null, role, is_active: true });

async function makeUser(role: Role, balanceCents = 0) {
  const { data } = await admin.auth.admin.createUser({ email: `del-${role}-${randomUUID().slice(0, 8)}@example.com`, password: "test-password-123", email_confirm: true });
  const id = data!.user!.id;
  await admin.from("user_profiles").insert({ id, display_name: role, role, is_active: true });
  if (balanceCents > 0) {
    await admin.rpc("apply_wallet_transaction", { p_account_type: "user", p_user_id: id, p_type: "manual_deposit", p_direction: "credit", p_amount: balanceCents, p_admin_id: null, p_reason: "seed", p_idempotency_key: randomUUID() });
  }
  return prof(id, role);
}
const balance = async (id: string) => (await admin.from("wallet_balances").select("balance").eq("user_id", id).single()).data!.balance as number;

let sa: UserProfile;

async function raceWinnerPool(n = 2, entryFee = 1000) {
  const comp = (await admin.from("racing_competitions").insert({ name: `Del-${randomUUID().slice(0, 6)}`, format: "SINGLE_RACE" }).select("id").single()).data!;
  const race = (await admin.from("races").insert({ competition_id: comp.id, title: "R", status: "SCHEDULED" }).select("id").single()).data!;
  const competitorIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = (await admin.from("competitors").insert({ number: `#${i + 1}`, is_persistent: false, created_for_race_id: race.id }).select("id").single()).data!;
    competitorIds.push(c.id);
    await admin.from("race_competitors").insert({ race_id: race.id, competitor_id: c.id, sort_order: i });
  }
  const res = await createRacingPoolForActor(admin, sa, { scope: "RACE", raceId: race.id, entryFeeCents: entryFee, houseFeeBps: 0, locksAt: "2035-01-01T00:00:00Z" });
  if (res.error) throw new Error(res.error);
  const opts = (await admin.from("pool_options").select("id, competitor_id").eq("pool_id", res.poolId!)).data!;
  return { competitionId: comp.id, raceId: race.id, competitorIds, poolId: res.poolId!, firstOption: opts[0].id as string };
}
const enter = (poolId: string, userId: string, optionId: string, amount = 1000) =>
  admin.rpc("create_pool_entry", { p_pool_id: poolId, p_user_id: userId, p_option_id: optionId, p_amount: amount, p_idempotency_key: randomUUID() });
const exists = async (table: string, id: string) => !!(await admin.from(table).select("id").eq("id", id).maybeSingle()).data;

describe.skipIf(!SR)("Phase 17 — delete competitions and races", () => {
  beforeAll(async () => { sa = await makeUser("super_admin"); });

  it("deletes a competition with a live entry: refunds the player, then tears everything down", async () => {
    const { competitionId, raceId, competitorIds, poolId, firstOption } = await raceWinnerPool();
    const player = await makeUser("player", 5000);
    await enter(poolId, player.id, firstOption); // debited 1000 -> 4000
    expect(await balance(player.id)).toBe(4000);
    // A pool-scoped notification (as real pool activity generates) must not
    // block the teardown via its RESTRICT FK.
    await admin.from("notifications").insert({ user_id: player.id, type: "pool_update", title: "t", body: "b", pool_id: poolId });

    const res = await deleteCompetitionForActor(admin, sa, competitionId);
    expect(res.error).toBeNull();

    // Player made whole via the audited refund path.
    expect(await balance(player.id)).toBe(5000);
    // Everything is gone.
    expect(await exists("racing_competitions", competitionId)).toBe(false);
    expect(await exists("races", raceId)).toBe(false);
    expect(await exists("pools", poolId)).toBe(false);
    expect(await exists("competitors", competitorIds[0])).toBe(false);
    expect((await admin.from("entries").select("id").eq("pool_id", poolId)).data).toEqual([]);
    expect((await admin.from("pool_options").select("id").eq("pool_id", poolId)).data).toEqual([]);
  });

  it("refuses to delete when a dependent pool has SETTLED (protects paid-out money)", async () => {
    const { competitionId, poolId } = await raceWinnerPool();
    await admin.from("pools").update({ status: "SETTLED" }).eq("id", poolId);

    const res = await deleteCompetitionForActor(admin, sa, competitionId);
    expect(res.error).toMatch(/settled/i);
    // Nothing was deleted.
    expect(await exists("racing_competitions", competitionId)).toBe(true);
    expect(await exists("pools", poolId)).toBe(true);
  });

  it("deletes a merely LOCKED pool (lock time passed) and still refunds its entry", async () => {
    const { competitionId, poolId, firstOption } = await raceWinnerPool();
    const player = await makeUser("player", 5000);
    await enter(poolId, player.id, firstOption); // debited 1000 -> 4000
    expect(await balance(player.id)).toBe(4000);
    // The lock cron would flip an open pool to LOCKED once its lock time passes.
    await admin.from("pools").update({ status: "LOCKED" }).eq("id", poolId);

    const res = await deleteCompetitionForActor(admin, sa, competitionId);
    expect(res.error).toBeNull();
    expect(await balance(player.id)).toBe(5000); // refunded despite being locked
    expect(await exists("racing_competitions", competitionId)).toBe(false);
    expect(await exists("pools", poolId)).toBe(false);
  });

  it("deleteRace removes one race + its pool but leaves the competition and other races", async () => {
    const { competitionId, raceId, poolId } = await raceWinnerPool();
    // A second race under the same competition.
    const race2 = (await admin.from("races").insert({ competition_id: competitionId, title: "R2", status: "SCHEDULED" }).select("id").single()).data!;

    const res = await deleteRaceForActor(admin, sa, raceId);
    expect(res.error).toBeNull();
    expect(await exists("races", raceId)).toBe(false);
    expect(await exists("pools", poolId)).toBe(false);
    expect(await exists("racing_competitions", competitionId)).toBe(true);
    expect(await exists("races", race2.id)).toBe(true);
  });

  it("refuses a non-Super-Admin", async () => {
    const { competitionId, raceId } = await raceWinnerPool();
    const organizer = await makeUser("organizer");
    expect((await deleteCompetitionForActor(admin, organizer, competitionId)).error).toMatch(/Super Admin/i);
    expect((await deleteRaceForActor(admin, organizer, raceId)).error).toMatch(/Super Admin/i);
    expect(await exists("racing_competitions", competitionId)).toBe(true);
  });
});
