/**
 * Integration tests for the Phase 2 racing domain schema
 * (RACING_IMPLEMENTATION_PLAN.md Phase 2). Schema/constraint/RLS coverage only —
 * no Server Actions, no organizer authorization, no grading/settlement.
 * Run with: pnpm test:integration (requires a local Supabase stack).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const admin = createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function newCompetition(format = "SINGLE_RACE") {
  const { data, error } = await admin
    .from("racing_competitions")
    .insert({ name: `Comp ${randomUUID().slice(0, 8)}`, format })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function newRace(competitionId: string, stageId: string | null = null) {
  const { data, error } = await admin
    .from("races")
    .insert({ competition_id: competitionId, stage_id: stageId, title: "Race", status: "SCHEDULED" })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

function newCompetitor(fields: Record<string, unknown>) {
  return admin.from("competitors").insert(fields).select("id").single();
}

function addToRace(raceId: string, competitorId: string, sortOrder = 0) {
  return admin
    .from("race_competitors")
    .insert({ race_id: raceId, competitor_id: competitorId, sort_order: sortOrder });
}

function insertResult(
  raceId: string,
  winnerId: string,
  opts: { revision?: number; status?: string; supersedes?: string | null } = {},
) {
  return admin
    .from("race_results")
    .insert({
      race_id: raceId,
      winner_competitor_id: winnerId,
      revision_number: opts.revision ?? 1,
      status: opts.status ?? "CONFIRMED",
      supersedes_result_id: opts.supersedes ?? null,
    })
    .select("id")
    .single();
}

function addPositions(
  resultId: string,
  raceId: string,
  rows: Array<{ competitorId: string; position: number | null }>,
) {
  return admin
    .from("race_result_positions")
    .insert(rows.map((r) => ({ race_result_id: resultId, race_id: raceId, competitor_id: r.competitorId, position: r.position })));
}

/** A race with N persistent competitors already attached. */
async function raceWithField(n: number) {
  const comp = await newCompetition();
  const race = await newRace(comp);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = await newCompetitor({ name: `C${i}-${randomUUID().slice(0, 6)}`, colors: ["Red"] });
    ids.push(c.data!.id);
    await addToRace(race, c.data!.id, i);
  }
  return { race, ids };
}

describe("racing schema — competitor model", () => {
  it("accepts a persistent competitor and a race-only competitor", async () => {
    const persistent = await newCompetitor({ name: "Red Rocket", is_persistent: true });
    expect(persistent.error).toBeNull();

    const comp = await newCompetition();
    const race = await newRace(comp);
    const raceOnly = await newCompetitor({ number: "#99", is_persistent: false, created_for_race_id: race });
    expect(raceOnly.error).toBeNull();
  });

  it("accepts identity by name only / number only / colors only / image only / combined", async () => {
    expect((await newCompetitor({ name: "Lightning" })).error).toBeNull();
    expect((await newCompetitor({ number: "#7" })).error).toBeNull();
    expect((await newCompetitor({ colors: ["Red"] })).error).toBeNull();
    expect((await newCompetitor({ image_url: "https://example.test/a.png" })).error).toBeNull();
    expect(
      (await newCompetitor({ name: "Lightning", number: "#7", colors: ["Red", "Black", "Gold"] })).error,
    ).toBeNull();
  });

  it("accepts 1 color and 4 colors; rejects 5 colors and an empty color array", async () => {
    expect((await newCompetitor({ colors: ["Red"] })).error).toBeNull();
    expect((await newCompetitor({ colors: ["Red", "White", "Blue", "Gold"] })).error).toBeNull();
    expect((await newCompetitor({ colors: ["a", "b", "c", "d", "e"] })).error).not.toBeNull();
    expect((await newCompetitor({ name: "X", colors: [] })).error).not.toBeNull();
  });

  it("rejects a competitor with no meaningful identifier", async () => {
    expect((await newCompetitor({ is_persistent: true })).error).not.toBeNull();
  });

  it("preserves color order", async () => {
    const ins = await newCompetitor({ colors: ["Red", "Black", "Gold"] });
    expect(ins.error).toBeNull();
    const { data } = await admin.from("competitors").select("colors").eq("id", ins.data!.id).single();
    expect(data!.colors).toEqual(["Red", "Black", "Gold"]);
  });

  it("enforces scope consistency: persistent must have no origin race; race-only must name one", async () => {
    const comp = await newCompetition();
    const race = await newRace(comp);
    // persistent + origin race -> rejected
    expect(
      (await newCompetitor({ name: "Bad1", is_persistent: true, created_for_race_id: race })).error,
    ).not.toBeNull();
    // race-only without origin race -> rejected
    expect((await newCompetitor({ name: "Bad2", is_persistent: false })).error).not.toBeNull();
  });
});

describe("racing schema — race-only scope (structural)", () => {
  it("reuses a persistent competitor across Race A and Race B", async () => {
    const persistent = await newCompetitor({ name: "Reused", is_persistent: true });
    const comp = await newCompetition("LEAGUE");
    const a = await newRace(comp);
    const b = await newRace(comp);
    expect((await addToRace(a, persistent.data!.id)).error).toBeNull();
    expect((await addToRace(b, persistent.data!.id)).error).toBeNull();
  });

  it("accepts a race-only competitor in its originating race, and REJECTS it in another race", async () => {
    const comp = await newCompetition();
    const raceA = await newRace(comp);
    const raceB = await newRace(comp);
    const raceOnly = await newCompetitor({ number: "#5", is_persistent: false, created_for_race_id: raceA });
    // allowed in its origin race
    expect((await addToRace(raceA, raceOnly.data!.id)).error).toBeNull();
    // rejected in a different race (trigger enforces scope)
    expect((await addToRace(raceB, raceOnly.data!.id)).error).not.toBeNull();
  });

  it("blocks hard-deleting a race that a race-only competitor was created for (history preserved)", async () => {
    const comp = await newCompetition();
    const race = await newRace(comp);
    const raceOnly = await newCompetitor({ name: "OneOff", is_persistent: false, created_for_race_id: race });
    const del = await admin.from("races").delete().eq("id", race);
    expect(del.error).not.toBeNull(); // ON DELETE RESTRICT
    // competitor identity still resolvable
    const { data } = await admin.from("competitors").select("id").eq("id", raceOnly.data!.id).single();
    expect(data!.id).toBe(raceOnly.data!.id);
  });

  it("keeps a persistent competitor's historical participation intact after deactivation", async () => {
    const persistent = await newCompetitor({ name: "Veteran", is_persistent: true });
    const comp = await newCompetition();
    const race = await newRace(comp);
    await addToRace(race, persistent.data!.id);
    expect((await admin.from("competitors").update({ is_active: false }).eq("id", persistent.data!.id)).error).toBeNull();
    const { count } = await admin
      .from("race_competitors")
      .select("*", { count: "exact", head: true })
      .eq("competitor_id", persistent.data!.id);
    expect(count).toBe(1);
  });
});

describe("racing schema — competition / stage / race hierarchy", () => {
  it("enforces explicit, unique stage ordering within a competition", async () => {
    const comp = await newCompetition("MIXED");
    expect(
      (await admin.from("competition_stages").insert({ competition_id: comp, name: "Group", stage_type: "GROUP", sequence_order: 1 })).error,
    ).toBeNull();
    expect(
      (await admin.from("competition_stages").insert({ competition_id: comp, name: "Final", stage_type: "KNOCKOUT", sequence_order: 2 })).error,
    ).toBeNull();
    expect(
      (await admin.from("competition_stages").insert({ competition_id: comp, name: "Dup", stage_type: "RACE", sequence_order: 1 })).error,
    ).not.toBeNull();
  });

  it("keeps a race consistent with its competition and optional stage", async () => {
    const comp = await newCompetition("CHAMPIONSHIP");
    const { data: stage } = await admin
      .from("competition_stages")
      .insert({ competition_id: comp, name: "S1", stage_type: "POINTS_STANDINGS", sequence_order: 1 })
      .select("id")
      .single();
    const race = await newRace(comp, stage!.id);
    const { data } = await admin.from("races").select("competition_id, stage_id").eq("id", race).single();
    expect(data!.competition_id).toBe(comp);
    expect(data!.stage_id).toBe(stage!.id);
    expect(
      (await admin.from("races").insert({ competition_id: randomUUID(), title: "orphan", status: "SCHEDULED" })).error,
    ).not.toBeNull();
  });
});

describe("racing schema — N competitors & participation", () => {
  it("supports an arbitrary field of competitors (N=5) in one race", async () => {
    const { race } = await raceWithField(5);
    const { count } = await admin
      .from("race_competitors")
      .select("*", { count: "exact", head: true })
      .eq("race_id", race);
    expect(count).toBe(5);
  });

  it("rejects the same competitor twice in the same race", async () => {
    const comp = await newCompetition();
    const race = await newRace(comp);
    const c = await newCompetitor({ name: "Twice" });
    expect((await addToRace(race, c.data!.id)).error).toBeNull();
    expect((await addToRace(race, c.data!.id)).error).not.toBeNull();
  });

  it("allows a progression placeholder slot (null competitor) but not a filled slot without a competitor", async () => {
    const comp = await newCompetition("BRACKET");
    const race = await newRace(comp);
    expect(
      (await admin.from("race_competitors").insert({ race_id: race, competitor_id: null, is_placeholder: true, source_rule: "WINNER" })).error,
    ).toBeNull();
    expect(
      (await admin.from("race_competitors").insert({ race_id: race, competitor_id: null, is_placeholder: false })).error,
    ).not.toBeNull();
  });
});

describe("racing schema — result model (single revision)", () => {
  it("accepts a winner-only result whose winner is in the race", async () => {
    const { race, ids } = await raceWithField(4);
    expect((await insertResult(race, ids[0])).error).toBeNull();
  });

  it("rejects a result whose winner is not a competitor in the race", async () => {
    const { race } = await raceWithField(3);
    const outsider = await newCompetitor({ name: "Outsider" });
    expect((await insertResult(race, outsider.data!.id)).error).not.toBeNull();
  });

  it("accepts an optional full finishing order and rejects a position for a non-participant", async () => {
    const { race, ids } = await raceWithField(4);
    const res = await insertResult(race, ids[0]);
    const full = await addPositions(res.data!.id, race, ids.map((id, i) => ({ competitorId: id, position: i + 1 })));
    expect(full.error).toBeNull();
    const outsider = await newCompetitor({ name: "Ghost" });
    const bad = await addPositions(res.data!.id, race, [{ competitorId: outsider.data!.id, position: 1 }]);
    expect(bad.error).not.toBeNull();
  });

  it("rejects a duplicate competitor within one revision, but represents a dead heat (shared place)", async () => {
    const { race, ids } = await raceWithField(3);
    const res = await insertResult(race, ids[0]);
    expect((await addPositions(res.data!.id, race, [{ competitorId: ids[0], position: 1 }])).error).toBeNull();
    // same competitor twice in the same revision -> rejected
    expect((await addPositions(res.data!.id, race, [{ competitorId: ids[0], position: 2 }])).error).not.toBeNull();
    // dead heat: a different competitor sharing position 1 IS allowed
    expect((await addPositions(res.data!.id, race, [{ competitorId: ids[1], position: 1 }])).error).toBeNull();
  });
});

describe("racing schema — result revisions (history preserved)", () => {
  it("confirms v1, corrects to v2, keeps v1 as SUPERSEDED, and keeps exactly one CONFIRMED", async () => {
    const { race, ids } = await raceWithField(4);

    // v1 confirmed
    const v1 = await insertResult(race, ids[0], { revision: 1, status: "CONFIRMED" });
    expect(v1.error).toBeNull();

    // a second CONFIRMED revision while v1 is still CONFIRMED -> rejected (partial unique)
    const clash = await insertResult(race, ids[1], { revision: 2, status: "CONFIRMED" });
    expect(clash.error).not.toBeNull();

    // proper correction: supersede v1, then confirm v2
    expect((await admin.from("race_results").update({ status: "SUPERSEDED", superseded_at: new Date().toISOString() }).eq("id", v1.data!.id)).error).toBeNull();
    const v2 = await insertResult(race, ids[1], { revision: 2, status: "CONFIRMED", supersedes: v1.data!.id });
    expect(v2.error).toBeNull();

    // history preserved: both revisions queryable; exactly one CONFIRMED
    const { data: all } = await admin.from("race_results").select("id, status, revision_number").eq("race_id", race).order("revision_number");
    expect(all!.length).toBe(2);
    expect(all!.filter((r) => r.status === "CONFIRMED").length).toBe(1);
    const current = all!.find((r) => r.status === "CONFIRMED")!;
    expect(current.revision_number).toBe(2);
    expect(all!.find((r) => r.status === "SUPERSEDED")!.revision_number).toBe(1);
  });

  it("keeps v2 positions independent of v1, and lets the same competitor appear once in each revision", async () => {
    const { race, ids } = await raceWithField(3);
    const v1 = await insertResult(race, ids[0], { revision: 1, status: "SUPERSEDED" });
    const v2 = await insertResult(race, ids[1], { revision: 2, status: "CONFIRMED", supersedes: v1.data!.id });

    // ids[0] appears in BOTH revisions (once each) — allowed
    expect((await addPositions(v1.data!.id, race, [{ competitorId: ids[0], position: 1 }])).error).toBeNull();
    expect((await addPositions(v2.data!.id, race, [{ competitorId: ids[0], position: 2 }])).error).toBeNull();

    // full independent orders per revision
    expect((await addPositions(v1.data!.id, race, [{ competitorId: ids[1], position: 2 }])).error).toBeNull();
    expect((await addPositions(v2.data!.id, race, [{ competitorId: ids[1], position: 1 }])).error).toBeNull();

    const { count: c1 } = await admin.from("race_result_positions").select("*", { count: "exact", head: true }).eq("race_result_id", v1.data!.id);
    const { count: c2 } = await admin.from("race_result_positions").select("*", { count: "exact", head: true }).eq("race_result_id", v2.data!.id);
    expect(c1).toBe(2);
    expect(c2).toBe(2);
  });

  it("represents DRAFT / CONFIRMED / SUPERSEDED without losing history; winner still constrained to the race", async () => {
    const { race, ids } = await raceWithField(3);
    expect((await insertResult(race, ids[0], { revision: 1, status: "DRAFT" })).error).toBeNull();
    expect((await insertResult(race, ids[1], { revision: 2, status: "CONFIRMED" })).error).toBeNull();
    // a revision whose winner is not in the race is still rejected
    const outsider = await newCompetitor({ name: "NotHere" });
    expect((await insertResult(race, outsider.data!.id, { revision: 3, status: "DRAFT" })).error).not.toBeNull();
  });
});

describe("racing schema — RLS least privilege", () => {
  let anon: ReturnType<typeof createSupabaseClient>;
  let seededCompetitor: string;

  beforeAll(async () => {
    anon = createSupabaseClient(SUPABASE_URL, ANON_KEY);
    const c = await newCompetitor({ name: "RLS probe" });
    seededCompetitor = c.data!.id;
  });

  it("anon cannot read racing tables", async () => {
    const { data, error } = await anon.from("competitors").select("id").limit(1);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("a normal authenticated member can READ but cannot WRITE racing tables", async () => {
    const email = `racing-rls-${Date.now()}@example.com`;
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password: "test-password-123",
      email_confirm: true,
    });
    if (cErr || !created.user) throw cErr ?? new Error("user");
    await admin
      .from("user_profiles")
      .insert({ id: created.user.id, display_name: "rls", role: "player", is_active: true });
    const member = createSupabaseClient(SUPABASE_URL, ANON_KEY);
    await member.auth.signInWithPassword({ email, password: "test-password-123" });

    const read = await member.from("competitors").select("id").eq("id", seededCompetitor);
    expect(read.error).toBeNull();
    expect((read.data ?? []).length).toBe(1);

    const write = await member.from("competitors").insert({ name: "should fail" });
    expect(write.error).not.toBeNull();
  });
});

afterAll(async () => {
  // Best-effort cleanup (children first; competitors last, after race_competitors,
  // so ON DELETE RESTRICT on competitor_id / created_for_race_id is satisfied).
  await admin.from("race_result_positions").delete().not("id", "is", null);
  await admin.from("race_results").delete().not("id", "is", null);
  await admin.from("race_competitors").delete().not("id", "is", null);
  await admin.from("competitors").delete().not("id", "is", null);
  await admin.from("races").delete().not("id", "is", null);
  await admin.from("competition_stages").delete().not("id", "is", null);
  await admin.from("racing_competitions").delete().not("id", "is", null);
});
