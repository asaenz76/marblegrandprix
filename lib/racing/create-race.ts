import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/guards";
import { isOrganizerOrAbove, userCanManageCompetition } from "@/lib/auth/racing";
import { createRaceSchema, type CreateRaceInput, type RaceCompetitorInput } from "@/lib/validations/races";

/**
 * Testable racing-creation core (Phase 4). Takes an already-authenticated actor
 * profile + a service-role client, so the authorization decision and the
 * ordered-insert-with-cleanup sequence can be exercised directly (the thin
 * "use server" wrapper in lib/actions/races.ts resolves the profile).
 *
 * Authorization:
 *   - creating a NEW standalone competition is global -> super_admin only.
 *   - creating a race in an EXISTING competition -> super_admin, or an organizer
 *     with a competition_organizers assignment (userCanManageCompetition).
 *   - players and legacy 'admin' are denied at the coarse gate.
 *
 * No privileged/SECURITY DEFINER RPC: a short sequence of service-role inserts
 * with explicit rollback on failure (nothing moves money; race-scoped rows
 * clean up deterministically).
 */

export type CreateRaceResult = { error: string | null; raceId?: string; competitionId?: string };
type Client = SupabaseClient;

async function rollback(
  client: Client,
  ids: { raceId?: string; raceOnlyCompetitorIds: string[]; newCompetitionId?: string },
) {
  // Children first; race-only competitors before the race (created_for_race_id
  // is ON DELETE RESTRICT), then the race, then a freshly-created competition.
  if (ids.raceId) await client.from("race_competitors").delete().eq("race_id", ids.raceId);
  if (ids.raceOnlyCompetitorIds.length) await client.from("competitors").delete().in("id", ids.raceOnlyCompetitorIds);
  if (ids.raceId) await client.from("races").delete().eq("id", ids.raceId);
  if (ids.newCompetitionId) await client.from("racing_competitions").delete().eq("id", ids.newCompetitionId);
}

export async function createRaceForActor(
  client: Client,
  actor: UserProfile,
  input: CreateRaceInput,
): Promise<CreateRaceResult> {
  if (!isOrganizerOrAbove(actor)) return { error: "You are not authorized to create races." };

  const parsed = createRaceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid race details." };
  const data = parsed.data;

  // --- Resolve competition context + authorize ---------------------------
  let competitionId: string;
  let newCompetitionId: string | undefined;

  if (data.newCompetitionName) {
    if (!isSuperAdmin(actor)) return { error: "Only a Super Admin can create a new competition." };
    // A standings-based competition (Championship/League) starts ACTIVE so it
    // can run and be finalized (Phase 7); a SINGLE_RACE competition keeps the
    // DRAFT default. The winner is published later by finalization, never here.
    const format = data.newCompetitionFormat;
    const { data: comp, error } = await client
      .from("racing_competitions")
      .insert({ name: data.newCompetitionName, format, status: format === "SINGLE_RACE" ? "DRAFT" : "ACTIVE", created_by: actor.id })
      .select("id")
      .single();
    if (error || !comp) return { error: "Could not create the competition." };
    competitionId = comp.id;
    newCompetitionId = comp.id;
  } else {
    competitionId = data.competitionId!;
    const { data: comp } = await client.from("racing_competitions").select("id").eq("id", competitionId).maybeSingle();
    if (!comp) return { error: "That competition does not exist." };
    if (!(await userCanManageCompetition(client, actor, competitionId))) {
      return { error: "You are not assigned to manage this competition." };
    }
  }

  // --- Create race + competitors (ordered inserts, rollback on failure) ---
  const raceOnlyCompetitorIds: string[] = [];
  let raceId: string | undefined;
  try {
    const { data: race, error: raceErr } = await client
      .from("races")
      .insert({
        competition_id: competitionId,
        stage_id: data.stageId ?? null,
        title: data.title,
        race_number: data.raceNumber ?? null,
        scheduled_start_utc: data.scheduledStartUtc ?? null,
        locks_at: data.locksAt ?? null,
        video_url: data.videoUrl ?? null,
        image_url: data.imageUrl ?? null,
        status: "SCHEDULED",
        created_by: actor.id,
      })
      .select("id")
      .single();
    if (raceErr || !race) throw new Error("race");
    const rid: string = race.id;
    raceId = rid;

    // Resolve every entrant row into ordered planned race_competitors rows. A
    // team entrant expands to one row per member marble (team affiliation is
    // global via racing_team_members, so no per-race team column is stored — the
    // winner and points stay per-marble). Progression slots keep a null occupant.
    type Planned =
      | { kind: "placeholder"; sourceRaceId: string; sourceRule: string; sourcePosition: number | null }
      | { kind: "competitor"; competitorId: string };
    const planned: Planned[] = [];

    for (const c of data.competitors) {
      if (c.advancesFrom) {
        const { data: src } = await client.from("races").select("competition_id").eq("id", c.advancesFrom.sourceRaceId).maybeSingle();
        if (!src || src.competition_id !== competitionId) throw new Error("slot-source"); // source must be in this competition
        planned.push({ kind: "placeholder", sourceRaceId: c.advancesFrom.sourceRaceId, sourceRule: c.advancesFrom.sourceRule, sourcePosition: c.advancesFrom.sourcePosition ?? null });
        continue;
      }
      if (c.teamId) {
        const { data: team } = await client.from("racing_teams").select("id, is_active").eq("id", c.teamId).maybeSingle();
        if (!team || !(team as { is_active: boolean }).is_active) throw new Error("team");
        const { data: members } = await client
          .from("racing_team_members")
          .select("competitor_id, competitors ( is_persistent, is_active )")
          .eq("team_id", c.teamId)
          .order("sort_order", { ascending: true });
        const list = (members ?? []) as unknown as Array<{ competitor_id: string; competitors: { is_persistent: boolean; is_active: boolean } | null }>;
        if (list.length === 0) throw new Error("team-empty");
        for (const m of list) {
          if (!m.competitors?.is_persistent || !m.competitors?.is_active) throw new Error("team-member");
          planned.push({ kind: "competitor", competitorId: m.competitor_id });
        }
        continue;
      }
      const competitorId = await resolveCompetitor(client, c, rid, actor.id, raceOnlyCompetitorIds);
      if (!competitorId) throw new Error("competitor");
      planned.push({ kind: "competitor", competitorId });
    }

    // Dedup marbles by competitor id (a marble added via two teams, or via a
    // team and individually, enters once — first occurrence wins). Placeholders
    // are distinct slots and never deduped.
    const seen = new Set<string>();
    const deduped = planned.filter((p) => {
      if (p.kind !== "competitor") return true;
      if (seen.has(p.competitorId)) return false;
      seen.add(p.competitorId);
      return true;
    });

    // The real race minimum applies AFTER team expansion.
    if (deduped.length < 2) throw new Error("min-entrants");

    for (let i = 0; i < deduped.length; i++) {
      const p = deduped[i];
      const { error: attachErr } =
        p.kind === "placeholder"
          ? await client.from("race_competitors").insert({
              race_id: rid,
              competitor_id: null,
              is_placeholder: true,
              sort_order: i,
              source_race_id: p.sourceRaceId,
              source_rule: p.sourceRule,
              source_position: p.sourcePosition,
            })
          : await client.from("race_competitors").insert({ race_id: rid, competitor_id: p.competitorId, sort_order: i });
      if (attachErr) throw new Error("attach"); // duplicate / race-only-scope violations land here
    }
  } catch {
    await rollback(client, { raceId, raceOnlyCompetitorIds, newCompetitionId });
    return { error: "Could not create the race. No partial data was saved." };
  }

  return { error: null, raceId, competitionId };
}

async function resolveCompetitor(
  client: Client,
  c: RaceCompetitorInput,
  raceId: string,
  createdBy: string,
  raceOnlyIds: string[],
): Promise<string | null> {
  if (c.existingCompetitorId) {
    // Only an active, persistent library competitor may be reused across races.
    const { data } = await client
      .from("competitors")
      .select("id, is_persistent, is_active")
      .eq("id", c.existingCompetitorId)
      .maybeSingle();
    if (!data || !data.is_persistent || !data.is_active) return null;
    return data.id;
  }

  const base = {
    name: c.name ?? null,
    number: c.number ?? null,
    colors: c.colors ?? null,
    image_url: c.imageUrl ?? null,
    created_by: createdBy,
  };
  const row = c.persistent
    ? { ...base, is_persistent: true }
    : { ...base, is_persistent: false, created_for_race_id: raceId };

  const { data, error } = await client.from("competitors").insert(row).select("id").single();
  if (error || !data) return null;
  if (!c.persistent) raceOnlyIds.push(data.id);
  return data.id;
}
