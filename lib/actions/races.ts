"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganizerOrAbove } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit/log";
import { createRaceForActor, type CreateRaceResult } from "@/lib/racing/create-race";
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
