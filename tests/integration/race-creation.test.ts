/**
 * Integration tests for Phase 4 — Single Race creation core
 * (lib/racing/create-race.ts). Exercises authorization, N-competitor creation,
 * persistent vs race-only competitors, and the structural rules, via the
 * testable core with constructed actor profiles + a service-role client.
 * No pool creation / grading / settlement. Run with: pnpm test:integration.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createRaceForActor } from "@/lib/racing/create-race";
import type { UserProfile } from "@/lib/auth/session";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const admin = createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

type Role = "super_admin" | "admin" | "organizer" | "player";
const profileOf = (id: string, role: Role): UserProfile => ({ id, display_name: "t", username: null, avatar_url: null, role, is_active: true });

async function createUser(role: Role) {
  const email = `race-create-${role}-${randomUUID().slice(0, 8)}@example.com`;
  const { data } = await admin.auth.admin.createUser({ email, password: "test-password-123", email_confirm: true });
  await admin.from("user_profiles").insert({ id: data!.user!.id, display_name: role, role, is_active: true });
  return profileOf(data!.user!.id, role);
}
async function newCompetition() {
  const { data } = await admin.from("racing_competitions").insert({ name: `C-${randomUUID().slice(0, 6)}`, format: "SINGLE_RACE" }).select("id").single();
  return data!.id as string;
}
const twoNew = () => [{ name: "Red", persistent: false }, { number: "#2", persistent: false }];

let superAdmin: UserProfile, orgA: UserProfile, orgB: UserProfile, player: UserProfile, legacyAdmin: UserProfile;
let assignedComp: string; // orgA assigned
let unassignedComp: string;

describe.skipIf(!SERVICE_ROLE_KEY)("Phase 4 — race creation core", () => {
  beforeAll(async () => {
    superAdmin = await createUser("super_admin");
    orgA = await createUser("organizer");
    orgB = await createUser("organizer");
    player = await createUser("player");
    legacyAdmin = await createUser("admin");
    assignedComp = await newCompetition();
    unassignedComp = await newCompetition();
    await admin.from("competition_organizers").insert({ competition_id: assignedComp, organizer_id: orgA.id, assigned_by: superAdmin.id });
  });

  // ---- AUTHORIZATION -----------------------------------------------------
  it("Super Admin can create a race (and a standalone competition inline)", async () => {
    const r = await createRaceForActor(admin, superAdmin, { newCompetitionName: `MGP ${randomUUID().slice(0, 5)}`, title: "Opening Race", competitors: twoNew() });
    expect(r.error).toBeNull();
    expect(r.raceId).toBeTruthy();
  });

  it("assigned Organizer can create a race in the assigned competition", async () => {
    const r = await createRaceForActor(admin, orgA, { competitionId: assignedComp, title: "Org Race", competitors: twoNew() });
    expect(r.error).toBeNull();
    expect(r.raceId).toBeTruthy();
  });

  it("Organizer cannot create a race in an unassigned competition", async () => {
    const r = await createRaceForActor(admin, orgA, { competitionId: unassignedComp, title: "Nope", competitors: twoNew() });
    expect(r.error).not.toBeNull();
    expect(r.raceId).toBeUndefined();
  });

  it("Organizer cannot create a new standalone competition (Super-Admin-only)", async () => {
    const r = await createRaceForActor(admin, orgA, { newCompetitionName: "Sneaky", title: "X", competitors: twoNew() });
    expect(r.error).not.toBeNull();
  });

  it("Player and legacy Admin cannot create a race", async () => {
    expect((await createRaceForActor(admin, player, { competitionId: assignedComp, title: "P", competitors: twoNew() })).error).not.toBeNull();
    expect((await createRaceForActor(admin, legacyAdmin, { competitionId: assignedComp, title: "A", competitors: twoNew() })).error).not.toBeNull();
  });

  // ---- RACE CREATION -----------------------------------------------------
  it("creates a race with 2, 4, and >4 competitors (arbitrary N)", async () => {
    for (const n of [2, 4, 7]) {
      const competitors = Array.from({ length: n }, (_, i) => ({ number: `#${i + 1}`, persistent: false }));
      const r = await createRaceForActor(admin, orgA, { competitionId: assignedComp, title: `N${n}`, competitors });
      expect(r.error).toBeNull();
      const { count } = await admin.from("race_competitors").select("*", { count: "exact", head: true }).eq("race_id", r.raceId!);
      expect(count).toBe(n);
    }
  });

  it("rejects fewer than 2 competitors", async () => {
    const r = await createRaceForActor(admin, orgA, { competitionId: assignedComp, title: "Solo", competitors: [{ name: "Red", persistent: false }] });
    expect(r.error).not.toBeNull();
  });

  it("rejects a duplicate existing competitor in the same race", async () => {
    const { data: comp } = await admin.from("competitors").insert({ name: "Dup", is_persistent: true }).select("id").single();
    const r = await createRaceForActor(admin, orgA, {
      competitionId: assignedComp,
      title: "DupRace",
      competitors: [{ existingCompetitorId: comp!.id }, { existingCompetitorId: comp!.id }],
    });
    expect(r.error).not.toBeNull();
  });

  it("rejects an invalid (non-existent) competition and leaves no partial data", async () => {
    const before = await admin.from("races").select("*", { count: "exact", head: true });
    const r = await createRaceForActor(admin, superAdmin, { competitionId: randomUUID(), title: "Ghost", competitors: twoNew() });
    expect(r.error).not.toBeNull();
    const after = await admin.from("races").select("*", { count: "exact", head: true });
    expect(after.count).toBe(before.count);
  });

  it("rejects lock time after scheduled start", async () => {
    const r = await createRaceForActor(admin, orgA, {
      competitionId: assignedComp,
      title: "BadSchedule",
      scheduledStartUtc: "2030-01-01T18:00:00Z",
      locksAt: "2030-01-01T19:00:00Z",
      competitors: twoNew(),
    });
    expect(r.error).not.toBeNull();
  });

  // ---- COMPETITORS -------------------------------------------------------
  it("creates competitors by name-only / number-only / colors-only; 1..4 colors; rejects >4 and no-identity", async () => {
    const ok = await createRaceForActor(admin, orgA, {
      competitionId: assignedComp,
      title: "Identity",
      competitors: [
        { name: "Lightning", persistent: false },
        { number: "#7", persistent: false },
        { colors: ["Red"], persistent: false },
        { colors: ["Red", "White", "Blue", "Gold"], persistent: false },
      ],
    });
    expect(ok.error).toBeNull();

    expect((await createRaceForActor(admin, orgA, { competitionId: assignedComp, title: "TooMany", competitors: [{ colors: ["a", "b", "c", "d", "e"], persistent: false }, { name: "Blue" }] })).error).not.toBeNull();
    expect((await createRaceForActor(admin, orgA, { competitionId: assignedComp, title: "NoId", competitors: [{ persistent: false }, { name: "Blue" }] })).error).not.toBeNull();
  });

  it("reuses a persistent competitor across races; a race-only competitor cannot be reused", async () => {
    // persistent, created inline in race 1, then reused in race 2
    const r1 = await createRaceForActor(admin, orgA, { competitionId: assignedComp, title: "Lib1", competitors: [{ name: "Champ", persistent: true }, { number: "#2", persistent: false }] });
    expect(r1.error).toBeNull();
    const { data: champ } = await admin.from("competitors").select("id").eq("name", "Champ").eq("is_persistent", true).maybeSingle();
    const r2 = await createRaceForActor(admin, orgA, { competitionId: assignedComp, title: "Lib2", competitors: [{ existingCompetitorId: champ!.id }, { number: "#3", persistent: false }] });
    expect(r2.error).toBeNull();

    // race-only competitor from r1 cannot be reused: attempting to add it as an
    // "existing" competitor is rejected (it is not persistent).
    const { data: raceOnly } = await admin.from("competitors").select("id").eq("is_persistent", false).limit(1).maybeSingle();
    const r3 = await createRaceForActor(admin, orgA, { competitionId: assignedComp, title: "ReuseRaceOnly", competitors: [{ existingCompetitorId: raceOnly!.id }, { number: "#9", persistent: false }] });
    expect(r3.error).not.toBeNull();
  });

  it("persists race-only competitors scoped to their originating race", async () => {
    const r = await createRaceForActor(admin, orgA, { competitionId: assignedComp, title: "ScopeRace", competitors: [{ name: "OneOff", persistent: false }, { number: "#2", persistent: false }] });
    expect(r.error).toBeNull();
    const { data } = await admin.from("competitors").select("created_for_race_id").eq("name", "OneOff").maybeSingle();
    expect(data!.created_for_race_id).toBe(r.raceId);
  });

  afterAll(async () => {
    await admin.from("race_competitors").delete().not("id", "is", null);
    await admin.from("races").delete().not("id", "is", null);
    await admin.from("racing_competitions").delete().not("id", "is", null);
    await admin.from("competitors").delete().not("id", "is", null);
    for (const u of [superAdmin, orgA, orgB, player, legacyAdmin]) if (u) await admin.from("user_profiles").update({ is_active: false }).eq("id", u.id);
  });
});
