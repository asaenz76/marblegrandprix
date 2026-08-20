"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganizerOrAbove } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit/log";
import {
  createTeamSchema,
  updateTeamSchema,
  type CreateTeamInput,
  type UpdateTeamInput,
} from "@/lib/validations/teams";

/**
 * CRUD for the racing teams library (F1-style constructors). A team groups 1+
 * library competitors ("drivers"); the constructors' championship is derived
 * live from these memberships (see lib/racing/constructor-standings.ts) and
 * this file NEVER touches winners/grading/settlement/standings.
 *
 * Auth: requireOrganizerOrAbove() — the same authority that manages the
 * competitor library. Teams are a shared global resource with no owning
 * competition. All writes go through the service-role admin client.
 */

// A marble is a valid team member only if it's an active, persistent library
// competitor (never a race-only or archived one). Returns an error string or null.
async function validateMembers(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<string | null> {
  const { data, error } = await admin
    .from("competitors")
    .select("id")
    .in("id", ids)
    .eq("is_persistent", true)
    .eq("is_active", true);
  if (error) return "Could not verify the selected marbles.";
  if ((data?.length ?? 0) !== ids.length) return "One or more selected marbles are not in the library.";
  return null;
}

const ALREADY_ON_TEAM = "One or more of those marbles are already on another team.";

export async function createTeamAction(input: CreateTeamInput): Promise<{ error: string | null; id?: string }> {
  const actor = await requireOrganizerOrAbove();
  const parsed = createTeamSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid team." };
  const admin = createAdminClient();

  const memberError = await validateMembers(admin, parsed.data.memberCompetitorIds);
  if (memberError) return { error: memberError };

  const { data: team, error: insertError } = await admin
    .from("racing_teams")
    .insert({
      name: parsed.data.name,
      image_url: parsed.data.imageUrl ?? null,
      color: parsed.data.color ?? null,
      is_active: true,
      created_by: actor.id,
    })
    .select("id")
    .single();
  if (insertError || !team) return { error: "Could not create the team." };

  const { error: rosterError } = await admin.rpc("set_racing_team_members", {
    p_team_id: team.id,
    p_competitor_ids: parsed.data.memberCompetitorIds,
  });
  if (rosterError) {
    // Undo the just-created team so nothing partial is saved (cascade removes
    // any members that did land).
    await admin.from("racing_teams").delete().eq("id", team.id);
    return { error: rosterError.code === "23505" ? ALREADY_ON_TEAM : "Could not set the team roster." };
  }

  await writeAuditLog({
    actorId: actor.id,
    action: "team.created",
    entityType: "racing_team",
    entityId: team.id,
    after: { name: parsed.data.name, members: parsed.data.memberCompetitorIds },
  });
  revalidatePath("/racing/teams");
  return { error: null, id: team.id };
}

export async function updateTeamAction(input: UpdateTeamInput): Promise<{ error: string | null }> {
  const actor = await requireOrganizerOrAbove();
  const parsed = updateTeamSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid team." };
  const admin = createAdminClient();

  const memberError = await validateMembers(admin, parsed.data.memberCompetitorIds);
  if (memberError) return { error: memberError };

  const { error: updateError } = await admin
    .from("racing_teams")
    .update({
      name: parsed.data.name,
      image_url: parsed.data.imageUrl ?? null,
      color: parsed.data.color ?? null,
    })
    .eq("id", parsed.data.id);
  if (updateError) return { error: "Could not update the team." };

  const { error: rosterError } = await admin.rpc("set_racing_team_members", {
    p_team_id: parsed.data.id,
    p_competitor_ids: parsed.data.memberCompetitorIds,
  });
  if (rosterError) return { error: rosterError.code === "23505" ? ALREADY_ON_TEAM : "Could not update the team roster." };

  await writeAuditLog({
    actorId: actor.id,
    action: "team.updated",
    entityType: "racing_team",
    entityId: parsed.data.id,
    after: { name: parsed.data.name, members: parsed.data.memberCompetitorIds },
  });
  revalidatePath("/racing/teams");
  // The team badge shows wherever its members race.
  revalidatePath("/feed");
  revalidatePath("/");
  return { error: null };
}

export async function deleteTeamAction(input: { id: string }): Promise<{ error: string | null; archived?: boolean }> {
  const actor = await requireOrganizerOrAbove();
  if (!input?.id) return { error: "Missing team." };
  const admin = createAdminClient();

  // Hard-delete when the team was never used in a race (cascade removes its
  // membership rows). Currently nothing FK-references racing_teams from race
  // data, so hard delete is the normal path; the archive fallback is kept for
  // forward-compatibility if a per-race team reference is added later.
  const { error } = await admin.from("racing_teams").delete().eq("id", input.id);
  if (!error) {
    await writeAuditLog({ actorId: actor.id, action: "team.deleted", entityType: "racing_team", entityId: input.id });
    revalidatePath("/racing/teams");
    return { error: null, archived: false };
  }
  if (error.code === "23503") {
    const { error: archiveError } = await admin.from("racing_teams").update({ is_active: false }).eq("id", input.id);
    if (archiveError) return { error: "Could not remove the team." };
    await writeAuditLog({ actorId: actor.id, action: "team.archived", entityType: "racing_team", entityId: input.id });
    revalidatePath("/racing/teams");
    return { error: null, archived: true };
  }
  return { error: "Could not remove the team." };
}
