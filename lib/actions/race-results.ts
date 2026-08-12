"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganizerOrAbove, requireSuperAdmin } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit/log";
import {
  recordRaceResultForActor,
  confirmRaceResultForActor,
  correctRaceResultForActor,
  type RecordResultResult,
  type ConfirmResultResult,
  type CorrectResultResult,
  type RaceResultPositionInput,
} from "@/lib/racing/race-result";

/**
 * Thin trust-boundary wrappers (Phase 6). The client never chooses the winning
 * pool option or moves money — it submits a result; the server authenticates,
 * enforces the Phase 3 assignment boundary, confirms the authoritative revision,
 * and the racing grader + existing settlement RPCs do the rest. Corrections
 * after settlement are Super-Admin-only.
 */

export async function recordRaceResultAction(input: {
  raceId: string;
  winnerCompetitorId: string;
  positions?: RaceResultPositionInput[];
}): Promise<RecordResultResult> {
  const actor = await requireOrganizerOrAbove();
  const res = await recordRaceResultForActor(createAdminClient(), actor, input);
  if (!res.error && res.resultId) {
    await writeAuditLog({ actorId: actor.id, action: "race_result.recorded", entityType: "race", entityId: input.raceId, after: { result_id: res.resultId, winner: input.winnerCompetitorId } });
  }
  return res;
}

export async function confirmRaceResultAction(input: { raceId: string; resultId: string }): Promise<ConfirmResultResult> {
  const actor = await requireOrganizerOrAbove();
  const res = await confirmRaceResultForActor(createAdminClient(), actor, input);
  if (!res.error) {
    await writeAuditLog({ actorId: actor.id, action: "race_result.confirmed", entityType: "race", entityId: input.raceId, after: { result_id: input.resultId, outcomes: res.outcomes } });
    revalidatePath("/racing/races");
  }
  return res;
}

export async function correctRaceResultAction(input: {
  raceId: string;
  newWinnerCompetitorId: string;
  positions?: RaceResultPositionInput[];
  reason: string;
}): Promise<CorrectResultResult> {
  // Super-Admin authority — enforced here AND inside the core.
  const actor = await requireSuperAdmin();
  const res = await correctRaceResultForActor(createAdminClient(), actor, input);
  if (!res.error) {
    await writeAuditLog({ actorId: actor.id, action: "race_result.corrected", entityType: "race", entityId: input.raceId, reason: input.reason, after: { new_winner: input.newWinnerCompetitorId, outcomes: res.outcomes } });
    revalidatePath("/racing/races");
  }
  return res;
}
