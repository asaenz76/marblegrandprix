"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCompetitionAccess, requireOrganizerOrAbove, requireSuperAdmin } from "@/lib/auth/session";
import {
  finalizeCompetitionForActor,
  refinalizeCompetitionForActor,
  type FinalizeResult,
} from "@/lib/racing/finalize-competition";
import { createCompetitionForActor, type CreateCompetitionInput, type CreateCompetitionResult } from "@/lib/racing/create-competition";
import { deleteCompetitionForActor } from "@/lib/racing/delete-racing";
import { pointsConfigSchema } from "@/lib/racing/points";
import { writeAuditLog } from "@/lib/audit/log";

/**
 * Thin trust-boundary wrappers (Phase 7). Competition finalization DERIVES the
 * champion from standings — the client never chooses a winner and never moves
 * money. The server authenticates and enforces the Phase 3 assignment boundary
 * (assigned Organizer or Super Admin); once the authoritative winner is
 * published, the existing Phase 5/6 grading + settlement path settles the
 * Competition Winner pool unchanged. Correcting a finalized competition is
 * Super-Admin-only (it may reverse a settled pool). Audit logging happens inside
 * the finalization core (it records the standings snapshot that produced the
 * outcome).
 */

export async function createCompetitionAction(input: CreateCompetitionInput): Promise<CreateCompetitionResult> {
  // Creating a competition is global — Super-Admin-only (enforced here AND in the core).
  const actor = await requireSuperAdmin();
  const res = await createCompetitionForActor(createAdminClient(), actor, input);
  if (!res.error && res.competitionId) {
    await writeAuditLog({ actorId: actor.id, action: "racing_competition.created", entityType: "racing_competition", entityId: res.competitionId, after: { name: input.name, format: input.format } });
    revalidatePath("/racing/competitions");
    revalidatePath("/racing");
  }
  return res;
}

// A public racing-image URL (from /api/racing-image) or null to clear it.
const racingImageUrlSchema = z.string().trim().url().max(2048).nullable();

/**
 * Phase 19: edit a competition's championship points table (position -> points),
 * used live by standings. Scoped to whoever manages the competition (assigned
 * Organizer or Super Admin). Standings recompute from this immediately.
 */
export async function updateCompetitionPointsAction(input: {
  competitionId: string;
  pointsConfig: Record<string, number>;
}): Promise<{ error: string | null }> {
  const actor = await requireCompetitionAccess(input.competitionId);
  const parsed = pointsConfigSchema.safeParse(input.pointsConfig);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid points table." };

  const { error } = await createAdminClient()
    .from("racing_competitions")
    .update({ points_config: parsed.data })
    .eq("id", input.competitionId);
  if (error) return { error: "Could not update the points table." };

  await writeAuditLog({
    actorId: actor.id,
    action: "racing_competition.points_updated",
    entityType: "racing_competition",
    entityId: input.competitionId,
    after: { points_config: parsed.data },
  });
  revalidatePath(`/racing/competitions/${input.competitionId}`);
  return { error: null };
}

/**
 * Phase 16: set or clear a competition's rounded icon. Cosmetic identity only —
 * no money, grading, or standings effect. Scoped to whoever can manage the
 * competition (assigned Organizer or Super Admin) via requireCompetitionAccess;
 * the image itself was already uploaded through the operator-only route.
 */
export async function updateCompetitionImageAction(input: {
  competitionId: string;
  imageUrl: string | null;
}): Promise<{ error: string | null }> {
  const actor = await requireCompetitionAccess(input.competitionId);
  const parsed = racingImageUrlSchema.safeParse(input.imageUrl);
  if (!parsed.success) return { error: "That image link is not valid." };

  const { error } = await createAdminClient()
    .from("racing_competitions")
    .update({ image_url: parsed.data })
    .eq("id", input.competitionId);
  if (error) return { error: "Could not update the competition image." };

  await writeAuditLog({
    actorId: actor.id,
    action: "racing_competition.image_updated",
    entityType: "racing_competition",
    entityId: input.competitionId,
    after: { image_url: parsed.data },
  });
  revalidatePath(`/racing/competitions/${input.competitionId}`);
  revalidatePath("/racing/competitions");
  // The icon is the card's top-line identity everywhere a racing pool renders.
  revalidatePath("/feed");
  revalidatePath("/");
  return { error: null };
}

/**
 * Phase 17: permanently delete a competition and everything under it (races,
 * race-only competitors, and pools). Super-Admin only. Live entries are
 * refunded through the audited money path; pools that have locked or settled
 * block the delete. Destructive and irreversible.
 */
export async function deleteCompetitionAction(input: { competitionId: string }): Promise<{ error: string | null }> {
  const actor = await requireSuperAdmin();
  const res = await deleteCompetitionForActor(createAdminClient(), actor, input.competitionId);
  if (!res.error) {
    await writeAuditLog({
      actorId: actor.id,
      action: "racing_competition.deleted",
      entityType: "racing_competition",
      entityId: input.competitionId,
    });
    revalidatePath("/racing/competitions");
    revalidatePath("/racing");
    revalidatePath("/feed");
    revalidatePath("/");
  }
  return res;
}

export async function finalizeCompetitionAction(input: { competitionId: string }): Promise<FinalizeResult> {
  const actor = await requireOrganizerOrAbove();
  const res = await finalizeCompetitionForActor(createAdminClient(), actor, input.competitionId);
  if (res.outcome === "finalized") {
    revalidatePath(`/racing/competitions/${input.competitionId}`);
    revalidatePath("/racing/competitions");
  }
  return res;
}

export async function refinalizeCompetitionAction(input: { competitionId: string; reason: string }): Promise<FinalizeResult> {
  // Super-Admin authority — enforced here AND inside the core (it may reverse a settled pool).
  const actor = await requireSuperAdmin();
  const res = await refinalizeCompetitionForActor(createAdminClient(), actor, input.competitionId, input.reason);
  if (res.outcome === "finalized" || res.outcome === "tied" || res.outcome === "ambiguous") {
    revalidatePath(`/racing/competitions/${input.competitionId}`);
    revalidatePath("/racing/competitions");
  }
  return res;
}
