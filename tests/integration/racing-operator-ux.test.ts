/**
 * Integration tests for Phase 10 operator UX cores — standalone competition
 * creation (auth + formats) and the operator-home data helper (awaiting result,
 * needs-attention, assignment scoping). No money math asserted; these exercise
 * read/create view-model behavior only. Run with: pnpm test:integration.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createCompetitionForActor } from "@/lib/racing/create-competition";
import { getOperatorHome } from "@/lib/racing/operator-home";
import { recordRaceResultForActor, confirmRaceResultForActor } from "@/lib/racing/race-result";
import type { UserProfile } from "@/lib/auth/session";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const admin = createSupabaseClient(URL, SR, { auth: { autoRefreshToken: false, persistSession: false } });

type Role = "super_admin" | "admin" | "organizer" | "player";
const prof = (id: string, role: Role): UserProfile => ({ id, display_name: "t", username: null, avatar_url: null, role, is_active: true });

async function makeUser(role: Role) {
  const email = `opux-${role}-${randomUUID().slice(0, 8)}@example.com`;
  const { data } = await admin.auth.admin.createUser({ email, password: "test-password-123", email_confirm: true });
  const id = data!.user!.id;
  await admin.from("user_profiles").insert({ id, display_name: role, role, is_active: true });
  return prof(id, role);
}
async function competitor(name: string) {
  return (await admin.from("competitors").insert({ name, is_persistent: true }).select("id").single()).data!.id as string;
}
async function race(competitionId: string, title: string) {
  return (await admin.from("races").insert({ competition_id: competitionId, title, status: "SCHEDULED", scheduled_start_utc: "2035-06-01T18:00:00Z" }).select("id").single()).data!.id as string;
}
async function attach(raceId: string, competitorId: string, order: number) {
  await admin.from("race_competitors").insert({ race_id: raceId, competitor_id: competitorId, sort_order: order });
}

let sa: UserProfile;

describe.skipIf(!SR)("Phase 10 — operator UX cores", () => {
  beforeAll(async () => { sa = await makeUser("super_admin"); });

  // ---- §6 standalone competition creation ---------------------------------
  it("Super Admin creates a competition; Organizer and Player cannot", async () => {
    const ok = await createCompetitionForActor(admin, sa, { name: `C-${randomUUID().slice(0, 6)}`, format: "CHAMPIONSHIP" });
    expect(ok.error).toBeNull();
    expect(ok.competitionId).toBeTruthy();
    const row = (await admin.from("racing_competitions").select("status, format").eq("id", ok.competitionId!).single()).data!;
    expect(row.status).toBe("ACTIVE"); // non-single-race starts active
    expect(row.format).toBe("CHAMPIONSHIP");

    const single = await createCompetitionForActor(admin, sa, { name: "S", format: "SINGLE_RACE" });
    expect((await admin.from("racing_competitions").select("status").eq("id", single.competitionId!).single()).data!.status).toBe("DRAFT");

    const org = await makeUser("organizer"), player = await makeUser("player");
    expect((await createCompetitionForActor(admin, org, { name: "X", format: "LEAGUE" })).error).toMatch(/Super Admin/);
    expect((await createCompetitionForActor(admin, player, { name: "X", format: "LEAGUE" })).error).toMatch(/Super Admin/);
  });

  // ---- §4 operator home: awaiting result ----------------------------------
  it("operator home lists races awaiting a result, and drops them once confirmed", async () => {
    const comp = (await createCompetitionForActor(admin, sa, { name: `H-${randomUUID().slice(0, 6)}`, format: "CHAMPIONSHIP" })).competitionId!;
    const r = await race(comp, "Round 1");
    const a = await competitor("A"), b = await competitor("B");
    await attach(r, a, 0); await attach(r, b, 1);

    let home = await getOperatorHome(admin, sa);
    expect(home.awaitingResult.some((x) => x.id === r)).toBe(true);

    const rec = await recordRaceResultForActor(admin, sa, { raceId: r, winnerCompetitorId: a });
    await confirmRaceResultForActor(admin, sa, { raceId: r, resultId: rec.resultId! });
    home = await getOperatorHome(admin, sa);
    expect(home.awaitingResult.some((x) => x.id === r)).toBe(false);
    // Championship with all races confirmed -> ready to finalize.
    expect(home.needsAttention.some((c) => c.id === comp && /finalize/i.test(c.reason))).toBe(true);
  });

  // ---- §3/§4 operator home scoping ----------------------------------------
  it("an organizer's home is scoped to assigned competitions only", async () => {
    const org = await makeUser("organizer");
    const mine = (await createCompetitionForActor(admin, sa, { name: `Mine-${randomUUID().slice(0, 6)}`, format: "CHAMPIONSHIP" })).competitionId!;
    const other = (await createCompetitionForActor(admin, sa, { name: `Other-${randomUUID().slice(0, 6)}`, format: "CHAMPIONSHIP" })).competitionId!;
    const rMine = await race(mine, "Mine R1"), rOther = await race(other, "Other R1");
    const a = await competitor("A"), b = await competitor("B");
    await attach(rMine, a, 0); await attach(rMine, b, 1); await attach(rOther, a, 0); await attach(rOther, b, 1);
    await admin.from("competition_organizers").insert({ competition_id: mine, organizer_id: org.id });

    const home = await getOperatorHome(admin, org);
    expect(home.awaitingResult.some((x) => x.id === rMine)).toBe(true);
    expect(home.awaitingResult.some((x) => x.id === rOther)).toBe(false);
    expect(home.competitionCount).toBe(1); // only the assigned one
  });

  // ---- unassigned organizer sees an empty home ----------------------------
  it("an unassigned organizer's home is empty", async () => {
    const org = await makeUser("organizer");
    const home = await getOperatorHome(admin, org);
    expect(home.competitionCount).toBe(0);
    expect(home.awaitingResult).toHaveLength(0);
  });
});
