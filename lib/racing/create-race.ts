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

    for (let i = 0; i < data.competitors.length; i++) {
      const c = data.competitors[i];
      // Phase 8: a progression placeholder slot — occupant deferred to the engine.
      if (c.advancesFrom) {
        const { data: src } = await client.from("races").select("competition_id").eq("id", c.advancesFrom.sourceRaceId).maybeSingle();
        if (!src || src.competition_id !== competitionId) throw new Error("slot-source"); // source must be in this competition
        const { error: slotErr } = await client.from("race_competitors").insert({
          race_id: raceId,
          competitor_id: null,
          is_placeholder: true,
          sort_order: i,
          source_race_id: c.advancesFrom.sourceRaceId,
          source_rule: c.advancesFrom.sourceRule,
          source_position: c.advancesFrom.sourcePosition ?? null,
        });
        if (slotErr) throw new Error("slot");
        continue;
      }
      const competitorId = await resolveCompetitor(client, c, rid, actor.id, raceOnlyCompetitorIds);
      if (!competitorId) throw new Error("competitor");
      const { error: attachErr } = await client
        .from("race_competitors")
        .insert({ race_id: raceId, competitor_id: competitorId, sort_order: i });
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
