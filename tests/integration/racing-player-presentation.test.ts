/**
 * Integration tests for Phase 9 — player-facing racing PRESENTATION/query layer.
 * These exercise the read-only view-model builders (getRacingPoolContexts,
 * getRaceResultView) against real racing data, plus that entry still flows
 * through the existing pool-entry machinery. No money math is asserted in TS —
 * only presentation truth. Run with: pnpm test:integration (local, guarded).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createRacingPoolForActor } from "@/lib/racing/create-racing-pool";
import { recordRaceResultForActor, confirmRaceResultForActor, correctRaceResultForActor, type RaceResultPositionInput } from "@/lib/racing/race-result";
import { getRacingPoolContexts, getRaceResultView, isRacingPool } from "@/lib/racing/pool-presentation";
import type { UserProfile } from "@/lib/auth/session";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const admin = createSupabaseClient(URL, SR, { auth: { autoRefreshToken: false, persistSession: false } });

type Role = "super_admin" | "admin" | "organizer" | "player";
const prof = (id: string, role: Role): UserProfile => ({ id, display_name: "t", username: null, avatar_url: null, role, is_active: true });

async function makeUser(role: Role, balanceCents = 0) {
  const email = `pres-${role}-${randomUUID().slice(0, 8)}@example.com`;
  const { data } = await admin.auth.admin.createUser({ email, password: "test-password-123", email_confirm: true });
  const id = data!.user!.id;
  await admin.from("user_profiles").insert({ id, display_name: role, role, is_active: true });
  if (balanceCents > 0) {
    await admin.rpc("apply_wallet_transaction", { p_account_type: "user", p_user_id: id, p_type: "manual_deposit", p_direction: "credit", p_amount: balanceCents, p_admin_id: null, p_reason: "seed", p_idempotency_key: randomUUID() });
  }
  return prof(id, role);
}

let sa: UserProfile;

async function competitor(fields: { name?: string; number?: string; colors?: string[]; raceOnly?: string }) {
  const row: Record<string, unknown> = { name: fields.name ?? null, number: fields.number ?? null, colors: fields.colors ?? null, is_persistent: !fields.raceOnly };
  if (fields.raceOnly) { row.is_persistent = false; row.created_for_race_id = fields.raceOnly; }
  return (await admin.from("competitors").insert(row).select("id").single()).data!.id as string;
}
async function competition(format = "SINGLE_RACE") {
  return (await admin.from("racing_competitions").insert({ name: `P9-${randomUUID().slice(0, 6)}`, format, status: format === "SINGLE_RACE" ? "DRAFT" : "ACTIVE" }).select("id").single()).data!.id as string;
}
async function race(competitionId: string) {
  return (await admin.from("races").insert({ competition_id: competitionId, title: "Race", status: "SCHEDULED" }).select("id").single()).data!.id as string;
}
async function attach(raceId: string, competitorId: string, order: number) {
  await admin.from("race_competitors").insert({ race_id: raceId, competitor_id: competitorId, sort_order: order });
}
async function raceWinnerPool(competitionId: string, raceId: string) {
  const res = await createRacingPoolForActor(admin, sa, { scope: "RACE", raceId, entryFeeCents: 1000, houseFeeBps: 0, locksAt: "2035-01-01T00:00:00Z" });
  if (res.error) throw new Error(res.error);
  return res.poolId!;
}
const poolRow = async (poolId: string) =>
  (await admin.from("pools").select("id, template_id, race_id, template_config, fixture_id").eq("id", poolId).single()).data!;
async function ctxFor(poolId: string) {
  const p = await poolRow(poolId);
  const map = await getRacingPoolContexts([{ id: p.id, template_id: p.template_id, race_id: p.race_id, template_config: p.template_config }]);
  return map.get(poolId)!;
}
async function confirm(raceId: string, winnerId: string, positions?: RaceResultPositionInput[]) {
  const rec = await recordRaceResultForActor(admin, sa, { raceId, winnerCompetitorId: winnerId, positions });
  if (rec.error) throw new Error(rec.error);
  return confirmRaceResultForActor(admin, sa, { raceId, resultId: rec.resultId! });
}
/** Build a Race Winner pool with N competitors carrying the given identities. */
async function buildRacePool(identities: Array<{ name?: string; number?: string; colors?: string[] }>) {
  const comp = await competition();
  const r = await race(comp);
  const ids: string[] = [];
  for (const [i, idn] of identities.entries()) { const c = await competitor(idn); ids.push(c); await attach(r, c, i); }
  const poolId = await raceWinnerPool(comp, r);
  return { comp, raceId: r, competitorIds: ids, poolId };
}

describe.skipIf(!SR)("Phase 9 — player racing presentation", () => {
  beforeAll(async () => { sa = await makeUser("super_admin"); });

  // ---- §32.1 racing pool (fixture_id null) loads ------------------------
  it("racing pool has fixture_id NULL and produces a racing context", async () => {
    const { poolId } = await buildRacePool([{ name: "Rojo" }, { name: "Azul" }]);
    expect((await poolRow(poolId)).fixture_id).toBeNull();
    const ctx = await ctxFor(poolId);
    expect(ctx).toBeDefined();
    expect(ctx.scope).toBe("RACE");
    expect(ctx.raceId).toBeTruthy();
  });

  // ---- §32.2-5 N=2/4/8 render; no Draw fabricated -----------------------
  it.each([2, 4, 8])("Race Winner N=%i renders exactly N competitor options (no Draw)", async (n) => {
    const idents = Array.from({ length: n }, (_, i) => ({ number: `#${i + 1}`, name: `M${i + 1}` }));
    const { poolId } = await buildRacePool(idents);
    const ctx = await ctxFor(poolId);
    const optionCompetitorNames = Object.values(ctx.optionCompetitors).map((c) => c.name);
    expect(Object.keys(ctx.optionCompetitors)).toHaveLength(n);
    expect(optionCompetitorNames).not.toContain("Draw");
    expect(optionCompetitorNames.sort()).toEqual(idents.map((i) => i.name).sort());
  });

  // ---- §32.6-9 identity variants + race-only competitor -----------------
  it("competitor identity works name-only / number-only / colors-only, and race-only displays", async () => {
    const comp = await competition();
    const r = await race(comp);
    const nameOnly = await competitor({ name: "Lightning" });
    const numberOnly = await competitor({ number: "#7" });
    const colorsOnly = await competitor({ colors: ["Red", "White"] });
    const raceOnly = await competitor({ number: "#9", raceOnly: r });
    await attach(r, nameOnly, 0); await attach(r, numberOnly, 1); await attach(r, colorsOnly, 2); await attach(r, raceOnly, 3);
    const poolId = await raceWinnerPool(comp, r);
    const ctx = await ctxFor(poolId);
    const identities = Object.values(ctx.optionCompetitors);
    expect(identities.find((c) => c.name === "Lightning")).toBeTruthy();
    expect(identities.find((c) => c.number === "#7" && !c.name)).toBeTruthy();
    expect(identities.find((c) => c.colors?.join("/") === "Red/White" && !c.name && !c.number)).toBeTruthy();
    // race-only competitor is presented identically (no persistence metadata leaks)
    expect(identities.filter((c) => c.number === "#9")).toHaveLength(1);
  });

  // ---- §32.10-11 entry via existing machinery + selection reflected -----
  it("player enters a racing pool through the existing entry RPC; the entry is recorded", async () => {
    const { poolId, competitorIds } = await buildRacePool([{ name: "Rojo" }, { name: "Azul" }]);
    const opt = (await admin.from("pool_options").select("id, competitor_id").eq("pool_id", poolId)).data!;
    const player = await makeUser("player", 5000);
    const optRojo = opt.find((o) => o.competitor_id === competitorIds[0])!.id;
    const { error } = await admin.rpc("create_pool_entry", { p_pool_id: poolId, p_user_id: player.id, p_option_id: optRojo, p_amount: 1000, p_idempotency_key: randomUUID() });
    expect(error).toBeNull();
    const entry = (await admin.from("entries").select("option_id, status").eq("pool_id", poolId).eq("user_id", player.id).single()).data!;
    expect(entry.option_id).toBe(optRojo);
    expect(entry.status).toBe("ACTIVE");
    expect(await balanceOf(player.id)).toBe(4000); // existing economics unchanged
  });

  // ---- §32.12-13 confirmed winner displays; DRAFT does not --------------
  it("DRAFT result is not shown as final; a CONFIRMED winner is", async () => {
    const { poolId, raceId, competitorIds } = await buildRacePool([{ name: "Rojo" }, { name: "Azul" }]);
    // DRAFT only
    const rec = await recordRaceResultForActor(admin, sa, { raceId, winnerCompetitorId: competitorIds[0] });
    expect(rec.error).toBeNull();
    expect((await getRaceResultView(raceId)).status).toBe("PENDING");
    expect((await ctxFor(poolId)).result!.status).toBe("PENDING");
    // Confirm
    await confirmRaceResultForActor(admin, sa, { raceId, resultId: rec.resultId! });
    const view = await getRaceResultView(raceId);
    expect(view.status).toBe("CONFIRMED");
    expect(view.winner?.name).toBe("Rojo");
    const ctx = await ctxFor(poolId);
    expect(ctx.winnerOptionId).toBeTruthy();
  });

  // ---- §32.14 SUPERSEDED not current -----------------------------------
  it("a SUPERSEDED revision is never the current result; the correction is", async () => {
    const { raceId, competitorIds } = await buildRacePool([{ name: "Rojo" }, { name: "Azul" }]);
    await confirm(raceId, competitorIds[0]); // Rojo
    await correctRaceResultForActor(admin, sa, { raceId, newWinnerCompetitorId: competitorIds[1], reason: "fix" });
    const view = await getRaceResultView(raceId);
    expect(view.winner?.name).toBe("Azul"); // current confirmed, not the superseded Rojo
  });

  // ---- §32.15-16 winner-only + partial order truth ---------------------
  it("winner-only result shows a winner and no fabricated order; partial order keeps only known positions", async () => {
    const wo = await buildRacePool([{ name: "Rojo" }, { name: "Azul" }, { name: "Verde" }]);
    await confirm(wo.raceId, wo.competitorIds[0]); // winner only
    const woView = await getRaceResultView(wo.raceId);
    expect(woView.winner?.name).toBe("Rojo");
    expect(woView.order).toHaveLength(0);

    const po = await buildRacePool([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }]);
    await confirm(po.raceId, po.competitorIds[0], [
      { competitorId: po.competitorIds[0], position: 1 },
      { competitorId: po.competitorIds[1], position: 2 },
      { competitorId: po.competitorIds[2], position: 3 },
    ]); // D unlisted
    const poView = await getRaceResultView(po.raceId);
    expect(poView.order).toHaveLength(3); // no fabricated 4th
    expect(poView.order.map((r) => r.position)).toEqual([1, 2, 3]);
  });

  // ---- dead heat truthful ----------------------------------------------
  it("a dead heat at the front is presented as ambiguous, not a false single winner", async () => {
    const { raceId, competitorIds } = await buildRacePool([{ name: "A" }, { name: "B" }, { name: "C" }]);
    await confirm(raceId, competitorIds[0], [
      { competitorId: competitorIds[0], position: 1 },
      { competitorId: competitorIds[1], position: 1 },
      { competitorId: competitorIds[2], position: 3 },
    ]);
    const view = await getRaceResultView(raceId);
    expect(view.status).toBe("AMBIGUOUS");
    expect(view.winner).toBeNull();
  });

  // ---- §32.20 Competition Winner pool renders --------------------------
  it("Competition Winner pool produces a COMPETITION-scope context with the champion once finalized", async () => {
    const comp = await competition("CHAMPIONSHIP");
    const r = await race(comp);
    const a = await competitor({ name: "Rojo" }), b = await competitor({ name: "Azul" });
    await attach(r, a, 0); await attach(r, b, 1);
    const res = await createRacingPoolForActor(admin, sa, { scope: "COMPETITION", competitionId: comp, entryFeeCents: 1000, houseFeeBps: 0, locksAt: "2035-01-01T00:00:00Z" });
    const ctx = await ctxFor(res.poolId!);
    expect(ctx.scope).toBe("COMPETITION");
    expect(ctx.champion).toBeNull(); // not finalized yet
    await admin.from("racing_competitions").update({ status: "COMPLETED", winner_competitor_id: a }).eq("id", comp);
    const ctx2 = await ctxFor(res.poolId!);
    expect(ctx2.champion?.name).toBe("Rojo");
    expect(ctx2.winnerOptionId).toBeTruthy();
  });

  // ---- §32.24 retained football/custom pool gets no racing context -----
  it("a non-racing pool is not treated as racing (football path untouched)", async () => {
    expect(isRacingPool({ template_id: null })).toBe(false);
    expect(isRacingPool({ template_id: "COMBO" })).toBe(false);
    expect(isRacingPool({ template_id: "RACE_WINNER" })).toBe(true);
    const map = await getRacingPoolContexts([{ id: randomUUID(), template_id: "CUSTOM", race_id: null, template_config: null }]);
    expect(map.size).toBe(0);
  });
});

const balanceOf = async (id: string) => (await admin.from("wallet_balances").select("balance").eq("user_id", id).single()).data!.balance as number;
