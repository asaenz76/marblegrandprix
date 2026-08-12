import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile } from "@/lib/auth/session";
import { isOrganizerOrAbove, userCanManageCompetition } from "@/lib/auth/racing";

/**
 * Minimal stage (round) authoring + status derivation for Phase 8. A stage is an
 * optional organizational grouping of races within a BRACKET/ELIMINATION
 * competition (e.g. "Quarter-finals"). The progression engine does not depend on
 * stages — they are for structure/display — so this stays intentionally small:
 * create a stage, and derive its status safely from its races. No new lifecycle
 * state is invented (UPCOMING/ACTIVE/COMPLETED already exist).
 */

type Client = SupabaseClient;

export type CreateStageResult = { error: string | null; stageId?: string };

export async function createStageForActor(
  client: Client,
  actor: UserProfile,
  input: { competitionId: string; name: string; stageType: "RACE" | "POINTS_STANDINGS" | "GROUP" | "KNOCKOUT"; sequenceOrder: number },
): Promise<CreateStageResult> {
  if (!isOrganizerOrAbove(actor)) return { error: "You are not authorized to create stages." };
  if (!(await userCanManageCompetition(client, actor, input.competitionId))) {
    return { error: "You are not assigned to manage this competition." };
  }
  const { data, error } = await client
    .from("competition_stages")
    .insert({ competition_id: input.competitionId, name: input.name, stage_type: input.stageType, sequence_order: input.sequenceOrder, status: "UPCOMING" })
    .select("id")
    .single();
  if (error || !data) return { error: "Could not create the stage (the round order must be unique)." };
  return { error: null, stageId: data.id };
}

/**
 * Recompute a stage's status from its races (safe derivation):
 *   COMPLETED — every race in the stage has a current CONFIRMED result
 *   ACTIVE    — at least one race has a confirmed result, or all slots are filled
 *   UPCOMING  — otherwise
 * Idempotent; no-op when the stage has no races.
 */
export async function refreshStageStatus(client: Client, stageId: string): Promise<void> {
  const { data: races } = await client.from("races").select("id").eq("stage_id", stageId);
  const raceIds = (races ?? []).map((r) => r.id);
  if (!raceIds.length) return;

  const { data: confirmed } = await client.from("race_results").select("race_id").in("race_id", raceIds).eq("status", "CONFIRMED");
  const confirmedRaces = new Set((confirmed ?? []).map((r) => r.race_id));

  const { data: openSlots } = await client.from("race_competitors").select("id").in("race_id", raceIds).eq("is_placeholder", true).limit(1);
  const hasUnfilledSlots = (openSlots ?? []).length > 0;

  let status: "UPCOMING" | "ACTIVE" | "COMPLETED";
  if (confirmedRaces.size === raceIds.length) status = "COMPLETED";
  else if (confirmedRaces.size > 0 || !hasUnfilledSlots) status = "ACTIVE";
  else status = "UPCOMING";

  await client.from("competition_stages").update({ status }).eq("id", stageId);
}
