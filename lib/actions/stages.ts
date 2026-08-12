"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganizerOrAbove } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit/log";
import { createStageForActor, type CreateStageResult } from "@/lib/racing/stages";

/**
 * Thin trust-boundary wrapper (Phase 8). Authenticates the caller and confirms
 * organizer eligibility; the core performs the per-competition assignment check.
 * Stages are structural only — no money is involved.
 */
export async function createStageAction(input: {
  competitionId: string;
  name: string;
  stageType: "RACE" | "POINTS_STANDINGS" | "GROUP" | "KNOCKOUT";
  sequenceOrder: number;
}): Promise<CreateStageResult> {
  const actor = await requireOrganizerOrAbove();
  const result = await createStageForActor(createAdminClient(), actor, input);
  if (!result.error && result.stageId) {
    await writeAuditLog({ actorId: actor.id, action: "racing_stage.created", entityType: "competition_stage", entityId: result.stageId, after: { competition_id: input.competitionId, name: input.name, stage_type: input.stageType } });
    revalidatePath(`/racing/competitions/${input.competitionId}`);
  }
  return result;
}
