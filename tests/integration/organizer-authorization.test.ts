/**
 * Integration tests for Phase 3 — Organizer role & many-to-many, assignment-
 * scoped authorization (RACING_IMPLEMENTATION_PLAN.md Phase 3). Authorization
 * model only: role model, competition_organizers assignments, the assignment/
 * descendant authorization logic, and the server-mediated trust boundary.
 * No racing workflows/UI. Run with: pnpm test:integration.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  isOrganizerOrAbove,
  userCanManageCompetition,
  userCanManageDescendant,
  resolveOwningCompetition,
} from "@/lib/auth/racing";
import type { UserProfile } from "@/lib/auth/session";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const admin = createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Role = "super_admin" | "admin" | "organizer" | "player";
function profileOf(id: string, role: Role): UserProfile {
  return { id, display_name: "t", username: null, avatar_url: null, role, is_active: true };
}

async function createUser(role: Role): Promise<{ id: string; email: string }> {
  const email = `orgauthz-${role}-${randomUUID().slice(0, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: "test-password-123", email_confirm: true });
  if (error || !data.user) throw error ?? new Error("user");
  await admin.from("user_profiles").insert({ id: data.user.id, display_name: role, role, is_active: true });
  return { id: data.user.id, email };
}

async function signIn(email: string) {
  const client = createSupabaseClient(SUPABASE_URL, ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email, password: "test-password-123" });
  if (error) throw error;
  return client;
}

async function newCompetition() {
  const { data } = await admin.from("racing_competitions").insert({ name: `C-${randomUUID().slice(0, 6)}`, format: "SINGLE_RACE" }).select("id").single();
  return data!.id as string;
}
function assign(competitionId: string, organizerId: string, assignedBy: string) {
  return admin.from("competition_organizers").insert({ competition_id: competitionId, organizer_id: organizerId, assigned_by: assignedBy });
}

let superAdmin: { id: string; email: string };
let orgA: { id: string; email: string };
let orgB: { id: string; email: string };
let player: { id: string; email: string };
let legacyAdmin: { id: string; email: string };
let compA: string, compB: string, compC: string;

describe.skipIf(!SERVICE_ROLE_KEY)("Phase 3 — organizer authorization", () => {
  beforeAll(async () => {
    superAdmin = await createUser("super_admin");
    orgA = await createUser("organizer");
    orgB = await createUser("organizer");
    player = await createUser("player");
    legacyAdmin = await createUser("admin");
    compA = await newCompetition();
    compB = await newCompetition();
    compC = await newCompetition();
    // Organizer A -> {A, B};  Organizer B -> {B}
    await assign(compA, orgA.id, superAdmin.id);
    await assign(compB, orgA.id, superAdmin.id);
    await assign(compB, orgB.id, superAdmin.id);
  });

  // ---- ROLE MODEL --------------------------------------------------------
  it("recognizes the target role model and denies player + legacy admin at the coarse gate", () => {
    expect(isOrganizerOrAbove(profileOf(superAdmin.id, "super_admin"))).toBe(true);
    expect(isOrganizerOrAbove(profileOf(orgA.id, "organizer"))).toBe(true);
    expect(isOrganizerOrAbove(profileOf(player.id, "player"))).toBe(false);
    // legacy admin does NOT inherit organizer/super_admin authority
    expect(isOrganizerOrAbove(profileOf(legacyAdmin.id, "admin"))).toBe(false);
  });

  // ---- ASSIGNMENTS -------------------------------------------------------
  it("supports many-to-many assignment and rejects duplicates", async () => {
    // already assigned A->A, A->B, B->B in setup
    const dup = await assign(compA, orgA.id, superAdmin.id);
    expect(dup.error).not.toBeNull(); // PK conflict
    expect(dup.error?.code).toBe("23505");
  });

  it("rejects assigning a non-organizer (player or legacy admin) as an organizer", async () => {
    expect((await assign(compC, player.id, superAdmin.id)).error).not.toBeNull();
    expect((await assign(compC, legacyAdmin.id, superAdmin.id)).error).not.toBeNull();
  });

  it("removing an assignment revokes future authority (history untouched)", async () => {
    const temp = await createUser("organizer");
    await assign(compC, temp.id, superAdmin.id);
    expect(await userCanManageCompetition(admin, profileOf(temp.id, "organizer"), compC)).toBe(true);
    const del = await admin.from("competition_organizers").delete().eq("competition_id", compC).eq("organizer_id", temp.id);
    expect(del.error).toBeNull();
    expect(await userCanManageCompetition(admin, profileOf(temp.id, "organizer"), compC)).toBe(false);
  });

  // ---- AUTHORIZATION -----------------------------------------------------
  it("Super Admin can manage any competition", async () => {
    const sa = profileOf(superAdmin.id, "super_admin");
    expect(await userCanManageCompetition(admin, sa, compA)).toBe(true);
    expect(await userCanManageCompetition(admin, sa, compB)).toBe(true);
    expect(await userCanManageCompetition(admin, sa, compC)).toBe(true);
  });

  it("Organizer A manages assigned A and B, but not unassigned C", async () => {
    const a = profileOf(orgA.id, "organizer");
    expect(await userCanManageCompetition(admin, a, compA)).toBe(true);
    expect(await userCanManageCompetition(admin, a, compB)).toBe(true);
    expect(await userCanManageCompetition(admin, a, compC)).toBe(false);
  });

  it("Organizer B manages only B; cannot manage A-only or unassigned C", async () => {
    const b = profileOf(orgB.id, "organizer");
    expect(await userCanManageCompetition(admin, b, compB)).toBe(true);
    expect(await userCanManageCompetition(admin, b, compA)).toBe(false);
    expect(await userCanManageCompetition(admin, b, compC)).toBe(false);
  });

  it("player cannot manage any competition; legacy admin cannot bypass assignment", async () => {
    expect(await userCanManageCompetition(admin, profileOf(player.id, "player"), compA)).toBe(false);
    // legacy admin, no assignment (and cannot be assigned) -> denied everywhere
    expect(await userCanManageCompetition(admin, profileOf(legacyAdmin.id, "admin"), compA)).toBe(false);
    expect(await userCanManageCompetition(admin, profileOf(legacyAdmin.id, "admin"), compB)).toBe(false);
  });

  it("a demoted organizer (now player) with a stale row is still denied by the role gate", async () => {
    // simulate: user has an assignment but is no longer an organizer
    const demoted = profileOf(orgA.id, "player");
    expect(await userCanManageCompetition(admin, demoted, compA)).toBe(false);
  });

  // ---- DESCENDANTS -------------------------------------------------------
  it("assignment authorizes descendants (stage/race/result) via the parent competition", async () => {
    // Build compA descendants: stage -> race -> competitor -> result
    const { data: stage } = await admin.from("competition_stages").insert({ competition_id: compA, name: "S", stage_type: "RACE", sequence_order: 1 }).select("id").single();
    const { data: race } = await admin.from("races").insert({ competition_id: compA, stage_id: stage!.id, title: "R", status: "SCHEDULED" }).select("id").single();
    const { data: comp } = await admin.from("competitors").insert({ name: "Red" }).select("id").single();
    await admin.from("race_competitors").insert({ race_id: race!.id, competitor_id: comp!.id });
    const { data: result } = await admin.from("race_results").insert({ race_id: race!.id, winner_competitor_id: comp!.id, status: "CONFIRMED" }).select("id").single();

    // descendants resolve to compA
    expect(await resolveOwningCompetition(admin, { stageId: stage!.id })).toBe(compA);
    expect(await resolveOwningCompetition(admin, { raceId: race!.id })).toBe(compA);
    expect(await resolveOwningCompetition(admin, { raceResultId: result!.id })).toBe(compA);

    const a = profileOf(orgA.id, "organizer");
    const b = profileOf(orgB.id, "organizer");
    // A (assigned to compA) can manage its descendants
    expect(await userCanManageDescendant(admin, a, { stageId: stage!.id })).toBe(true);
    expect(await userCanManageDescendant(admin, a, { raceId: race!.id })).toBe(true);
    expect(await userCanManageDescendant(admin, a, { raceResultId: result!.id })).toBe(true);
    // B (NOT assigned to compA) cannot manage compA's descendants
    expect(await userCanManageDescendant(admin, b, { raceId: race!.id })).toBe(false);
    expect(await userCanManageDescendant(admin, b, { raceResultId: result!.id })).toBe(false);
  });

  it("cannot manage descendants of an unassigned competition", async () => {
    const { data: race } = await admin.from("races").insert({ competition_id: compC, title: "RC", status: "SCHEDULED" }).select("id").single();
    const a = profileOf(orgA.id, "organizer");
    expect(await userCanManageDescendant(admin, a, { raceId: race!.id })).toBe(false);
  });

  // ---- SECURITY / TRUST BOUNDARY ----------------------------------------
  it("anon and authenticated users cannot read or write competition_organizers directly", async () => {
    const anon = createSupabaseClient(SUPABASE_URL, ANON_KEY);
    const anonRead = await anon.from("competition_organizers").select("competition_id").limit(1);
    expect(anonRead.error !== null || (anonRead.data ?? []).length === 0).toBe(true);

    const orgClient = await signIn(orgA.email);
    // an authenticated organizer cannot read assignment data from the browser...
    const read = await orgClient.from("competition_organizers").select("competition_id").limit(1);
    expect((read.data ?? []).length).toBe(0);
    // ...nor insert an assignment for themselves (no grant + RLS)
    const write = await orgClient.from("competition_organizers").insert({ competition_id: compC, organizer_id: orgA.id });
    expect(write.error).not.toBeNull();
  });

  it("an authenticated organizer cannot mutate racing tables directly via PostgREST", async () => {
    const orgClient = await signIn(orgA.email);
    // organizer is assigned to compA, but still cannot write races from the browser
    const write = await orgClient.from("races").insert({ competition_id: compA, title: "hack", status: "SCHEDULED" });
    expect(write.error).not.toBeNull();
    const compWrite = await orgClient.from("racing_competitions").insert({ name: "hack", format: "SINGLE_RACE" });
    expect(compWrite.error).not.toBeNull();
  });

  it("the service-role server path remains functional", async () => {
    const c = await newCompetition();
    expect(await userCanManageCompetition(admin, profileOf(superAdmin.id, "super_admin"), c)).toBe(true);
  });

  afterAll(async () => {
    for (const c of [compA, compB, compC]) {
      await admin.from("race_result_positions").delete().eq("race_id", c); // noop-safe
    }
    // deleting competitions cascades stages/races/race_competitors/results + assignments
    await admin.from("race_results").delete().not("id", "is", null);
    await admin.from("race_competitors").delete().not("id", "is", null);
    await admin.from("racing_competitions").delete().not("id", "is", null);
    await admin.from("competitors").delete().not("id", "is", null);
    for (const u of [superAdmin, orgA, orgB, player, legacyAdmin]) {
      if (u) await admin.from("user_profiles").update({ is_active: false }).eq("id", u.id);
    }
  });
});
