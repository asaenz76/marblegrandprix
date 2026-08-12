"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit/log";

/**
 * Super-Admin management of competition_organizers assignments (Phase 3).
 *
 * Only a Super Admin may assign/remove organizers — enforced here by
 * requireSuperAdmin(), the trust boundary. Mutations go through the service-role
 * client after that check; the browser never mutates competition_organizers
 * directly (no authenticated grant exists on the table). The DB trigger also
 * rejects assigning any user whose role is not exactly 'organizer'.
 *
 * No Organizer dashboard/UI in Phase 3 — this is the minimal, trusted mechanism
 * the authorization model needs, exercised by tests and any future admin surface.
 */

export type OrganizerAssignmentResult = { error: string | null };

export async function assignOrganizerToCompetition(
  competitionId: string,
  organizerId: string,
): Promise<OrganizerAssignmentResult> {
  const admin = await requireSuperAdmin();
  const client = createAdminClient();

  const { error } = await client
    .from("competition_organizers")
    .insert({ competition_id: competitionId, organizer_id: organizerId, assigned_by: admin.id });

  if (error) {
    // Duplicate assignment (PK) or non-organizer assignee (trigger) land here.
    if (error.code === "23505") return { error: "That organizer is already assigned to this competition." };
    return { error: "Could not assign organizer. The user must have the organizer role." };
  }

  await writeAuditLog({
    actorId: admin.id,
    action: "competition.organizer_assigned",
    entityType: "racing_competition",
    entityId: competitionId,
    after: { organizer_id: organizerId },
  });

  return { error: null };
}

export async function removeOrganizerFromCompetition(
  competitionId: string,
  organizerId: string,
): Promise<OrganizerAssignmentResult> {
  const admin = await requireSuperAdmin();
  const client = createAdminClient();

  // Removing an assignment revokes future management authority; it does not
  // touch any racing history (races/results are independent of assignments).
  const { error } = await client
    .from("competition_organizers")
    .delete()
    .eq("competition_id", competitionId)
    .eq("organizer_id", organizerId);

  if (error) return { error: "Could not remove organizer assignment." };

  await writeAuditLog({
    actorId: admin.id,
    action: "competition.organizer_removed",
    entityType: "racing_competition",
    entityId: competitionId,
    before: { organizer_id: organizerId },
  });

  return { error: null };
}

export async function listCompetitionOrganizers(competitionId: string): Promise<string[]> {
  await requireSuperAdmin();
  const client = createAdminClient();
  const { data } = await client
    .from("competition_organizers")
    .select("organizer_id")
    .eq("competition_id", competitionId);
  return (data ?? []).map((r) => r.organizer_id as string);
}
