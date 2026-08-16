import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { UserProfile } from "@/lib/auth/session";
import { isOrganizerOrAbove, userCanManageCompetition } from "@/lib/auth/racing";
import { getLatestRacingTemplate } from "@/lib/pools/racing-templates";

/**
 * Racing TEMPLATE_GRADED pool creation (Phase 5, minimum backend path). Generates
 * one option per competitor (option.competitor_id set) — arbitrary N, no
 * home/away/draw, no odds, no fixtures. Existing pool economics are unchanged:
 * fixed entry fee, platform fee (house_fee_bps), min entries, visibility, lock
 * time — all reuse the existing pools/pool_options columns and defaults. No
 * settlement, no grading here (grading is lib/racing/grade-race-pool.ts).
 */

type Client = SupabaseClient;

export type CreateRacingPoolResult = { error: string | null; poolId?: string };

export const createRacingPoolSchema = z
  .object({
    scope: z.enum(["RACE", "COMPETITION"]),
    raceId: z.string().uuid().optional(),
    competitionId: z.string().uuid().optional(),
    entryFeeCents: z.number().int().positive(),
    houseFeeBps: z.number().int().min(0).max(10000).default(0),
    locksAt: z.string().datetime({ offset: true }),
    openAt: z.string().datetime({ offset: true }).optional(),
    // Phase 13 (approved additive exception): pool visibility is part of the
    // pool's creation state and is written atomically in the same insert.
    // Optional + defaulted to the existing Public value, so every prior caller
    // that omits it behaves exactly as before (the pools column also defaults
    // to VISIBLE_TO_ALL_MEMBERS). Reuses the existing pool_visibility enum —
    // no new states. Nothing else about creation semantics changes.
    visibility: z.enum(["VISIBLE_TO_ALL_MEMBERS", "HIDDEN"]).default("VISIBLE_TO_ALL_MEMBERS"),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.scope === "RACE" && !v.raceId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "raceId is required for a Race Winner pool.", path: ["raceId"] });
    if (v.scope === "COMPETITION" && !v.competitionId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "competitionId is required for a Competition Winner pool.", path: ["competitionId"] });
  });

export type CreateRacingPoolInput = z.input<typeof createRacingPoolSchema>;

type CompetitorRow = { id: string; name: string | null; number: string | null; colors: string[] | null };

function competitorLabel(c: CompetitorRow): string {
  return (c.name?.trim() || c.number?.trim() || (c.colors && c.colors.length ? c.colors.join(" / ") : "") || "Competitor").slice(0, 120);
}

export async function createRacingPoolForActor(
  client: Client,
  actor: UserProfile,
  input: CreateRacingPoolInput,
): Promise<CreateRacingPoolResult> {
  if (!isOrganizerOrAbove(actor)) return { error: "You are not authorized to create pools." };
  const parsed = createRacingPoolSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid pool details." };
  const data = parsed.data;

  // --- Resolve competition context + authorize + gather competitors -------
  let competitionId: string;
  let raceId: string | null = null;
  let templateId: "RACE_WINNER" | "COMPETITION_WINNER";
  let competitors: CompetitorRow[] = [];

  if (data.scope === "RACE") {
    raceId = data.raceId!;
    templateId = "RACE_WINNER";
    const { data: race } = await client.from("races").select("id, competition_id, status").eq("id", raceId).maybeSingle();
    if (!race) return { error: "That race does not exist." };
    if (["CANCELLED", "ABANDONED"].includes(race.status)) return { error: "This race cannot host a pool." };
    competitionId = race.competition_id;
    // Eligible competitors = filled (non-placeholder) participants of the race.
    const { data: rc } = await client
      .from("race_competitors")
      .select("competitor_id, competitors ( id, name, number, colors )")
      .eq("race_id", raceId)
      .not("competitor_id", "is", null)
      .order("sort_order");
    competitors = (rc ?? []).map((r) => r.competitors as unknown as CompetitorRow).filter(Boolean);
  } else {
    competitionId = data.competitionId!;
    templateId = "COMPETITION_WINNER";
    const { data: comp } = await client.from("racing_competitions").select("id, status").eq("id", competitionId).maybeSingle();
    if (!comp) return { error: "That competition does not exist." };
    if (comp.status === "CANCELLED") return { error: "This competition cannot host a pool." };
    // Competition competitors = distinct filled participants across its races.
    const { data: races } = await client.from("races").select("id").eq("competition_id", competitionId);
    const raceIds = (races ?? []).map((r) => r.id);
    if (raceIds.length) {
      const { data: rc } = await client
        .from("race_competitors")
        .select("competitor_id, competitors ( id, name, number, colors )")
        .in("race_id", raceIds)
        .not("competitor_id", "is", null);
      const seen = new Set<string>();
      for (const r of rc ?? []) {
        const c = r.competitors as unknown as CompetitorRow;
        if (c && !seen.has(c.id)) { seen.add(c.id); competitors.push(c); }
      }
    }
  }

  if (!(await userCanManageCompetition(client, actor, competitionId))) {
    return { error: "You are not assigned to manage this competition." };
  }

  // --- Validate the option field ------------------------------------------
  const uniqueIds = new Set(competitors.map((c) => c.id));
  if (uniqueIds.size !== competitors.length) return { error: "A competitor appears more than once." };
  if (competitors.length < 2) return { error: "A prediction pool needs at least 2 competitors." };

  const template = getLatestRacingTemplate(templateId);
  if (!template) return { error: "No active racing template." };

  // --- Insert pool + one option per competitor (existing economics) -------
  const { data: pool, error: poolErr } = await client
    .from("pools")
    .insert({
      pool_type: "TEMPLATE_GRADED",
      template_id: template.id,
      template_version: template.version,
      template_config: data.scope === "COMPETITION" ? { competition_id: competitionId } : {},
      race_id: raceId,
      question: template.question,
      entry_fee: data.entryFeeCents,
      house_fee_bps: data.houseFeeBps,
      open_at: data.openAt ?? new Date().toISOString(),
      locks_at: data.locksAt,
      visibility: data.visibility,
      status: "OPEN",
      created_by: actor.id,
    })
    .select("id")
    .single();
  if (poolErr || !pool) return { error: "Could not create the pool." };

  const optionRows = competitors.map((c, i) => ({
    pool_id: pool.id,
    label: competitorLabel(c),
    competitor_id: c.id,
    sort_order: i,
  }));
  const { error: optErr } = await client.from("pool_options").insert(optionRows);
  if (optErr) {
    await client.from("pool_options").delete().eq("pool_id", pool.id);
    await client.from("pools").delete().eq("id", pool.id);
    return { error: "Could not create the pool options." };
  }

  return { error: null, poolId: pool.id };
}
