/**
 * Integration tests for Phase 13 — operator racing pool creation. Exercises the
 * tested creation core (createRacingPoolForActor) against real data: the auth
 * matrix, template fixed by scope, entry-fee/platform-fee/lock-time validation,
 * the approved additive visibility field, OPEN status + context, options ==
 * competitors, feed-eligibility, and that a player can enter the new pool via
 * the existing entry machinery. No money math is asserted here; grading/
 * settlement/wallet semantics are untouched. Run: pnpm test:integration.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createRacingPoolForActor } from "@/lib/racing/create-racing-pool";
import { getRacingPoolContexts } from "@/lib/racing/pool-presentation";
import type { UserProfile } from "@/lib/auth/session";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const admin = createSupabaseClient(URL, SR, { auth: { autoRefreshToken: false, persistSession: false } });

type Role = "super_admin" | "admin" | "organizer" | "player";
const prof = (id: string, role: Role): UserProfile => ({ id, display_name: "t", username: null, avatar_url: null, role, is_active: true });

async function makeUser(role: Role, balanceCents = 0) {
  const email = `poolcreate-${role}-${randomUUID().slice(0, 8)}@example.com`;
  const { data } = await admin.auth.admin.createUser({ email, password: "test-password-123", email_confirm: true });
  const id = data!.user!.id;
  await admin.from("user_profiles").insert({ id, display_name: role, role, is_active: true });
  if (balanceCents > 0) {
    await admin.rpc("apply_wallet_transaction", { p_account_type: "user", p_user_id: id, p_type: "manual_deposit", p_direction: "credit", p_amount: balanceCents, p_admin_id: null, p_reason: "seed", p_idempotency_key: randomUUID() });
  }
  return prof(id, role);
}
async function competition(format = "CHAMPIONSHIP") {
  return (await admin.from("racing_competitions").insert({ name: `P13-${randomUUID().slice(0, 6)}`, format, status: "ACTIVE" }).select("id").single()).data!.id as string;
}
async function race(competitionId: string) {
  return (await admin.from("races").insert({ competition_id: competitionId, title: "Race", status: "SCHEDULED", scheduled_start_utc: "2035-06-01T18:00:00Z" }).select("id").single()).data!.id as string;
}
async function competitor(fields: { name?: string; number?: string; colors?: string[] }) {
  return (await admin.from("competitors").insert({ name: fields.name ?? null, number: fields.number ?? null, colors: fields.colors ?? null, is_persistent: true }).select("id").single()).data!.id as string;
}
async function attach(raceId: string, competitorId: string, order: number) {
  await admin.from("race_competitors").insert({ race_id: raceId, competitor_id: competitorId, sort_order: order });
}
async function assign(competitionId: string, organizerId: string) {
  await admin.from("competition_organizers").insert({ competition_id: competitionId, organizer_id: organizerId });
}

const FUTURE = "2035-06-01T18:00:00.000Z";
const base = { entryFeeCents: 500, houseFeeBps: 1000, locksAt: FUTURE } as const;

let sa: UserProfile, org: UserProfile, org2: UserProfile, player: UserProfile, legacyAdmin: UserProfile;

describe.skipIf(!SR)("Phase 13 — operator racing pool creation", () => {
  beforeAll(async () => {
    sa = await makeUser("super_admin");
    org = await makeUser("organizer");
    org2 = await makeUser("organizer");
    player = await makeUser("player", 5000);
    legacyAdmin = await makeUser("admin");
  });

  // A CHAMPIONSHIP with one race + two competitors, optionally assigning `to`.
  async function raceWith2(to?: UserProfile) {
    const comp = await competition("CHAMPIONSHIP");
    const r = await race(comp);
    const a = await competitor({ name: "Azure", number: "7", colors: ["#2f6bff"] });
    const b = await competitor({ name: "Crimson", number: "3", colors: ["#e23b3b"] });
    await attach(r, a, 0);
    await attach(r, b, 1);
    if (to) await assign(comp, to.id);
    return { comp, r, a, b };
  }

  it("assigned organizer creates a Race Winner pool — template/status/context/fees/options all correct", async () => {
    const { r, a, b } = await raceWith2(org);
    const res = await createRacingPoolForActor(admin, org, { scope: "RACE", raceId: r, ...base });
    expect(res.error).toBeNull();
    const pool = (await admin.from("pools").select("template_id, status, race_id, visibility, house_fee_bps, entry_fee").eq("id", res.poolId!).single()).data!;
    expect(pool.template_id).toBe("RACE_WINNER"); // template fixed by RACE scope
    expect(pool.status).toBe("OPEN"); // created directly OPEN
    expect(pool.race_id).toBe(r); // correct race context
    expect(pool.visibility).toBe("VISIBLE_TO_ALL_MEMBERS"); // Public by default
    expect(pool.entry_fee).toBe(500); // valid entry fee accepted
    expect(pool.house_fee_bps).toBe(1000); // valid platform fee accepted
    const opts = (await admin.from("pool_options").select("competitor_id").eq("pool_id", res.poolId!)).data!;
    expect(new Set(opts.map((o) => o.competitor_id))).toEqual(new Set([a, b])); // options == race competitors
  });

  it("assigned organizer creates a Competition Winner pool — options == distinct competition participants", async () => {
    const comp = await competition("CHAMPIONSHIP");
    const r1 = await race(comp), r2 = await race(comp);
    const a = await competitor({ name: "A" }), b = await competitor({ name: "B" }), c = await competitor({ name: "C" });
    await attach(r1, a, 0); await attach(r1, b, 1); await attach(r2, b, 0); await attach(r2, c, 1);
    await assign(comp, org.id);
    const res = await createRacingPoolForActor(admin, org, { scope: "COMPETITION", competitionId: comp, ...base });
    expect(res.error).toBeNull();
    const pool = (await admin.from("pools").select("template_id, status, template_config").eq("id", res.poolId!).single()).data!;
    expect(pool.template_id).toBe("COMPETITION_WINNER"); // template fixed by COMPETITION scope
    expect(pool.status).toBe("OPEN");
    expect((pool.template_config as { competition_id: string }).competition_id).toBe(comp); // correct competition context
    const opts = (await admin.from("pool_options").select("competitor_id").eq("pool_id", res.poolId!)).data!;
    expect(new Set(opts.map((o) => o.competitor_id))).toEqual(new Set([a, b, c])); // distinct union across races
  });

  it("an unassigned organizer is denied", async () => {
    const { r } = await raceWith2(); // org2 not assigned
    const res = await createRacingPoolForActor(admin, org2, { scope: "RACE", raceId: r, ...base });
    expect(res.error).toMatch(/not assigned/i);
    expect(res.poolId).toBeUndefined();
  });

  it("a Player and a legacy Admin are both denied (no racing authority)", async () => {
    const { r } = await raceWith2();
    expect((await createRacingPoolForActor(admin, player, { scope: "RACE", raceId: r, ...base })).error).toMatch(/not authorized/i);
    expect((await createRacingPoolForActor(admin, legacyAdmin, { scope: "RACE", raceId: r, ...base })).error).toMatch(/not authorized/i);
  });

  it("a Super Admin can create both scopes globally", async () => {
    const { comp, r } = await raceWith2();
    expect((await createRacingPoolForActor(admin, sa, { scope: "RACE", raceId: r, ...base })).error).toBeNull();
    expect((await createRacingPoolForActor(admin, sa, { scope: "COMPETITION", competitionId: comp, ...base })).error).toBeNull();
  });

  it("rejects an invalid entry fee, platform fee, or lock time", async () => {
    const { r } = await raceWith2(sa);
    expect((await createRacingPoolForActor(admin, sa, { scope: "RACE", raceId: r, entryFeeCents: 0, houseFeeBps: 1000, locksAt: FUTURE })).error).toBeTruthy();
    expect((await createRacingPoolForActor(admin, sa, { scope: "RACE", raceId: r, entryFeeCents: 500, houseFeeBps: 10001, locksAt: FUTURE })).error).toBeTruthy();
    expect((await createRacingPoolForActor(admin, sa, { scope: "RACE", raceId: r, entryFeeCents: 500, houseFeeBps: 1000, locksAt: "not-a-date" })).error).toBeTruthy();
  });

  it("visibility: omitted → Public, explicit Public → Public, Hidden → Hidden, invalid → error", async () => {
    const readVis = async (poolId?: string) => (await admin.from("pools").select("visibility").eq("id", poolId!).single()).data!.visibility;

    const r1 = (await raceWith2(sa)).r;
    const p1 = await createRacingPoolForActor(admin, sa, { scope: "RACE", raceId: r1, ...base }); // omitted
    expect(await readVis(p1.poolId)).toBe("VISIBLE_TO_ALL_MEMBERS"); // backward-compatible default

    const r2 = (await raceWith2(sa)).r;
    const p2 = await createRacingPoolForActor(admin, sa, { scope: "RACE", raceId: r2, ...base, visibility: "VISIBLE_TO_ALL_MEMBERS" });
    expect(await readVis(p2.poolId)).toBe("VISIBLE_TO_ALL_MEMBERS");

    const r3 = (await raceWith2(sa)).r;
    const p3 = await createRacingPoolForActor(admin, sa, { scope: "RACE", raceId: r3, ...base, visibility: "HIDDEN" });
    expect(await readVis(p3.poolId)).toBe("HIDDEN");

    const r4 = (await raceWith2(sa)).r;
    const bad = await createRacingPoolForActor(admin, sa, { scope: "RACE", raceId: r4, ...base, visibility: "BOGUS" as "HIDDEN" });
    expect(bad.error).toBeTruthy();
    expect(bad.poolId).toBeUndefined();
  });

  it("a Public OPEN pool is feed-eligible and resolves through the player racing presentation path", async () => {
    const { r } = await raceWith2(sa);
    const res = await createRacingPoolForActor(admin, sa, { scope: "RACE", raceId: r, ...base });
    // Matches the feed's own filter: VISIBLE_TO_ALL_MEMBERS + OPEN + future lock.
    const feedRow = (await admin.from("pools").select("locks_at").eq("id", res.poolId!).eq("visibility", "VISIBLE_TO_ALL_MEMBERS").eq("status", "OPEN").maybeSingle()).data;
    expect(feedRow).not.toBeNull();
    expect(new Date(feedRow!.locks_at).getTime()).toBeGreaterThan(Date.now());
    // Resolves through the same racing presentation adapter the player card uses.
    const p = (await admin.from("pools").select("id, template_id, race_id, template_config").eq("id", res.poolId!).single()).data!;
    const ctx = (await getRacingPoolContexts([{ id: p.id, template_id: p.template_id, race_id: p.race_id, template_config: p.template_config }])).get(res.poolId!)!;
    expect(ctx.scope).toBe("RACE");
    expect(Object.keys(ctx.optionCompetitors).length).toBe(2);
  });

  it("a player can enter the newly-created pool via the existing entry machinery", async () => {
    const { r } = await raceWith2(sa);
    const res = await createRacingPoolForActor(admin, sa, { scope: "RACE", raceId: r, ...base });
    const opt = (await admin.from("pool_options").select("id").eq("pool_id", res.poolId!).limit(1).single()).data!;
    const entrant = await makeUser("player", 5000);
    const { error } = await admin.rpc("create_pool_entry", { p_pool_id: res.poolId!, p_user_id: entrant.id, p_option_id: opt.id, p_amount: 500, p_idempotency_key: randomUUID() });
    expect(error).toBeNull();
    const entry = (await admin.from("entries").select("option_id").eq("pool_id", res.poolId!).eq("user_id", entrant.id).single()).data!;
    expect(entry.option_id).toBe(opt.id);
  });
});
