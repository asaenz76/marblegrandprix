"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganizerOrAbove } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit/log";
import { parseDollarsToCents, parsePercentToBps } from "@/lib/utils/money";
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

export type CreateRacingPoolFormState = { error: string | null; poolId?: string };

/**
 * Phase 13 form wrapper for the operator pool-creation UI. Parses the operator's
 * raw form inputs (dollar entry fee, percent platform fee, a client-computed ISO
 * lock time, visibility) into the typed shape the tested action expects, mapping
 * bad input to plain-language errors — no raw Zod/PostgREST ever reaches the
 * operator. Scope + context (race/competition) are fixed by the page, so the
 * operator never picks a template id. Delegates to createRacingPoolAction, which
 * enforces authorization + assignment scope and creates the pool OPEN.
 */
export async function createRacingPoolFromFormAction(
  _prev: CreateRacingPoolFormState,
  formData: FormData,
): Promise<CreateRacingPoolFormState> {
  const scope = String(formData.get("scope") ?? "");
  if (scope !== "RACE" && scope !== "COMPETITION") {
    return { error: "Something went wrong — reload the page and try again." };
  }

  const entryFeeCents = parseDollarsToCents(String(formData.get("entryFee") ?? ""));
  if (entryFeeCents === null) {
    return { error: "Enter a valid entry fee — a positive dollar amount like 5 or 5.00." };
  }

  const houseFeeBps = parsePercentToBps(String(formData.get("platformFee") ?? ""));
  if (houseFeeBps === null) {
    return { error: "Platform fee must be a percentage between 0 and 100." };
  }

  const locksAt = String(formData.get("locksAt") ?? "");
  if (!locksAt || Number.isNaN(Date.parse(locksAt))) {
    return { error: "Choose a valid lock time." };
  }

  const visibility = String(formData.get("visibility") ?? "");
  if (visibility !== "VISIBLE_TO_ALL_MEMBERS" && visibility !== "HIDDEN") {
    return { error: "Choose who can see this pool." };
  }

  const raceId = scope === "RACE" ? String(formData.get("raceId") ?? "") || undefined : undefined;
  const competitionId =
    scope === "COMPETITION" ? String(formData.get("competitionId") ?? "") || undefined : undefined;

  const result = await createRacingPoolAction({
    scope,
    raceId,
    competitionId,
    entryFeeCents,
    houseFeeBps,
    locksAt,
    visibility,
  });

  if (!result.error && result.poolId) {
    revalidatePath(scope === "RACE" ? `/racing/races/${raceId}` : `/racing/competitions/${competitionId}`);
  }
  return { error: result.error, poolId: result.poolId };
}
