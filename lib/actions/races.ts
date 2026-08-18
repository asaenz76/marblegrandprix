"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCompetitionAccess, requireOrganizerOrAbove, requireSuperAdmin } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit/log";
import { createRaceForActor, type CreateRaceResult } from "@/lib/racing/create-race";
import { deleteRaceForActor } from "@/lib/racing/delete-racing";
import type { CreateRaceInput } from "@/lib/validations/races";

/**
 * Thin trust-boundary wrapper (Phase 4). Authenticates the caller and confirms
 * they are eligible to attempt organizer actions (organizer or super_admin;
 * players and legacy 'admin' are rejected), then delegates to the testable core
 * which performs the per-competition assignment check and the creation.
 * Mutations run through the service-role client — the browser never writes
 * racing tables directly.
 */
export async function createRaceAction(input: CreateRaceInput): Promise<CreateRaceResult> {
  const actor = await requireOrganizerOrAbove();
  const result = await createRaceForActor(createAdminClient(), actor, input);

  if (!result.error && result.raceId) {
    await writeAuditLog({
      actorId: actor.id,
      action: "race.created",
      entityType: "race",
      entityId: result.raceId,
      after: { competition_id: result.competitionId, competitor_count: input.competitors?.length ?? 0 },
    });
    revalidatePath("/admin/races");
  }
  return result;
}

/**
 * Phase 17: permanently delete a race and everything under it (its race-only
 * competitors and pools). Super-Admin only. Live entries are refunded through
 * the audited money path; a locked/settled pool blocks the delete. Irreversible.
 */
export async function deleteRaceAction(input: { raceId: string }): Promise<{ error: string | null }> {
  const actor = await requireSuperAdmin();
  const res = await deleteRaceForActor(createAdminClient(), actor, input.raceId);
  if (!res.error) {
    await writeAuditLog({
      actorId: actor.id,
      action: "race.deleted",
      entityType: "race",
      entityId: input.raceId,
    });
    revalidatePath("/racing/races");
    revalidatePath("/racing");
    revalidatePath("/feed");
    revalidatePath("/");
  }
  return res;
}

// A public racing-image URL (from /api/racing-image) or null to clear it.
const racingImageUrlSchema = z.string().trim().url().max(2048).nullable();

/**
 * Phase 16: set or clear a race's rounded icon. Cosmetic identity only — no
 * money, grading, or result effect. Authorized against the race's competition
 * (assigned Organizer or Super Admin) via requireCompetitionAccess.
 */
export async function updateRaceImageAction(input: {
  raceId: string;
  imageUrl: string | null;
}): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const { data: race } = await admin
    .from("races")
    .select("competition_id")
    .eq("id", input.raceId)
    .maybeSingle();
  if (!race) return { error: "That race does not exist." };

  const actor = await requireCompetitionAccess(race.competition_id);
  const parsed = racingImageUrlSchema.safeParse(input.imageUrl);
  if (!parsed.success) return { error: "That image link is not valid." };

  const { error } = await admin.from("races").update({ image_url: parsed.data }).eq("id", input.raceId);
  if (error) return { error: "Could not update the race image." };

  await writeAuditLog({
    actorId: actor.id,
    action: "race.image_updated",
    entityType: "race",
    entityId: input.raceId,
    after: { image_url: parsed.data },
  });
  revalidatePath(`/racing/races/${input.raceId}`);
  revalidatePath("/racing/races");
  // The race icon shows on its pool cards in the feed/landing too.
  revalidatePath("/feed");
  revalidatePath("/");
  return { error: null };
}

/**
 * Phase 16: set or clear a competitor's photo. Cosmetic identity only — no
 * money, grading, or result effect. Authorized against the race's competition
 * (assigned Organizer or Super Admin); the competitor must belong to that race.
 * Lets an operator add a photo to an already-created competitor without
 * recreating the race.
 */
export async function updateCompetitorImageAction(input: {
  raceId: string;
  competitorId: string;
  imageUrl: string | null;
}): Promise<{ error: string | null }> {
  const admin = createAdminClient();
  const { data: race } = await admin
    .from("races")
    .select("competition_id")
    .eq("id", input.raceId)
    .maybeSingle();
  if (!race) return { error: "That race does not exist." };

  const actor = await requireCompetitionAccess(race.competition_id);

  const { data: link } = await admin
    .from("race_competitors")
    .select("competitor_id")
    .eq("race_id", input.raceId)
    .eq("competitor_id", input.competitorId)
    .maybeSingle();
  if (!link) return { error: "That competitor is not in this race." };

  const parsed = racingImageUrlSchema.safeParse(input.imageUrl);
  if (!parsed.success) return { error: "That image link is not valid." };

  const { error } = await admin.from("competitors").update({ image_url: parsed.data }).eq("id", input.competitorId);
  if (error) return { error: "Could not update the competitor image." };

  await writeAuditLog({
    actorId: actor.id,
    action: "competitor.image_updated",
    entityType: "competitor",
    entityId: input.competitorId,
    after: { image_url: parsed.data },
  });
  revalidatePath(`/racing/races/${input.raceId}`);
  revalidatePath("/feed");
  revalidatePath("/");
  return { error: null };
}
