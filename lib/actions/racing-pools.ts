"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganizerOrAbove } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit/log";
import { createRacingPoolForActor, type CreateRacingPoolInput, type CreateRacingPoolResult } from "@/lib/racing/create-racing-pool";

/**
 * Thin trust-boundary wrapper (Phase 5) for creating a racing TEMPLATE_GRADED
 * pool (Race Winner / Competition Winner). Authenticates + eligibility-gates,
 * then delegates to the testable core, which performs the per-competition
 * assignment check and generates one option per competitor. Mutations run via
 * the service-role client — the browser never writes pools/pool_options
 * directly. No grading or settlement here.
 */
export async function createRacingPoolAction(input: CreateRacingPoolInput): Promise<CreateRacingPoolResult> {
  const actor = await requireOrganizerOrAbove();
  const result = await createRacingPoolForActor(createAdminClient(), actor, input);

  if (!result.error && result.poolId) {
    await writeAuditLog({
      actorId: actor.id,
      action: "racing_pool.created",
      entityType: "pool",
      entityId: result.poolId,
      after: { scope: input.scope, race_id: input.raceId ?? null, competition_id: input.competitionId ?? null },
    });
    revalidatePath("/racing/races");
  }
  return result;
}
