"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganizerOrAbove, requireSuperAdmin } from "@/lib/auth/session";
import {
  finalizeCompetitionForActor,
  refinalizeCompetitionForActor,
  type FinalizeResult,
} from "@/lib/racing/finalize-competition";

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
