import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { UserProfile } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/guards";

/**
 * Standalone competition creation (Phase 10 UX). Lets an operator create a
 * competition first, then add races to it — instead of the previous flow where a
 * competition could only be born inside the race-creation form. It creates the
 * competition row only; no races, no money, no new rules. Creating a competition
 * is a global act, so it stays Super-Admin-only (mirrors create-race.ts) — an
 * Organizer manages races within competitions a Super Admin assigned them to.
 *
 * CHAMPIONSHIP/LEAGUE/BRACKET/ELIMINATION start ACTIVE (they run immediately and
 * accept races/results); SINGLE_RACE keeps the DRAFT default. points_config is
 * left to the schema default (the approved 10/6/4/3/2/1 preset) — no config
 * editor in V1.
 */

type Client = SupabaseClient;

export const createCompetitionSchema = z
  .object({
    name: z.string().trim().min(1, "A competition needs a name.").max(120),
    format: z.enum(["SINGLE_RACE", "CHAMPIONSHIP", "LEAGUE", "BRACKET", "ELIMINATION"]),
    // Optional rounded icon (Phase 16). A public URL produced by the
    // /api/racing-image upload route; never a browser-supplied storage write.
    imageUrl: z.string().trim().url().max(2048).optional(),
  })
  .strict();

export type CreateCompetitionInput = z.infer<typeof createCompetitionSchema>;
export type CreateCompetitionResult = { error: string | null; competitionId?: string };

export async function createCompetitionForActor(
  client: Client,
  actor: UserProfile,
  input: CreateCompetitionInput,
): Promise<CreateCompetitionResult> {
  if (!isSuperAdmin(actor)) return { error: "Only a Super Admin can create a competition." };
  const parsed = createCompetitionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid competition details." };
  const { name, format, imageUrl } = parsed.data;

  const { data, error } = await client
    .from("racing_competitions")
    .insert({ name, format, image_url: imageUrl ?? null, status: format === "SINGLE_RACE" ? "DRAFT" : "ACTIVE", created_by: actor.id })
    .select("id")
    .single();
  if (error || !data) return { error: "Could not create the competition." };
  return { error: null, competitionId: data.id };
}
