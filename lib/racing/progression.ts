import type { SupabaseClient } from "@supabase/supabase-js";
import { settleCompetitionPools } from "@/lib/racing/finalize-competition";
import type { SettleRacePoolOutcome } from "@/lib/racing/settle-race-pool";
import { refreshStageStatus } from "@/lib/racing/stages";
import { writeAuditLog } from "@/lib/audit/log";

/**
 * Knockout / single-elimination progression engine (Phase 8). When a source
 * race's result is CONFIRMED, it DETERMINISTICALLY fills the downstream
 * placeholder slots that reference it, so a bracket advances round-by-round to a
 * structurally-final race whose winner is the competition champion.
 *
 * It changes competition STRUCTURE (which competitor occupies which slot); it is
 * NOT another money engine. It moves no money directly: the structurally-final
 * winner is published to racing_competitions.winner_competitor_id and the
 * EXISTING Phase 5/6 Competition Winner grading + settlement path resolves the
 * pool unchanged (via settleCompetitionPools). grade-race-pool.ts and
 * settle-race-pool.ts are never modified.
 *
 * Two share these primitives but differ in the advancement rule:
 *   BRACKET      — source_rule = WINNER   (the confirmed winner advances)
 *   ELIMINATION  — source_rule = POSITION (only an explicit, unambiguous
 *                  finishing position advances; e.g. top 4 of 6)
 *
 * Invariants (all enforced here):
 *   - Only the current CONFIRMED revision is ever read (DRAFT/SUPERSEDED ignored).
 *   - Nothing is inferred: a POSITION with no explicit FINISHED evidence, or a
 *     dead heat at the advancement boundary, does NOT progress — it is left for
 *     review (the slot simply stays a placeholder).
 *   - Idempotent: re-processing fills a placeholder once; a slot already holding
 *     the correct competitor is a no-op; a slot holding a DIFFERENT competitor is
 *     a conflict (never silently overwritten) unless an authorized correction
 *     explicitly allows replacement while the downstream is still safely mutable.
 *   - Automatic winner publication only for BRACKET/ELIMINATION, only for the
 *     unique structurally-final race, only when its winner is unambiguous.
 */

type Client = SupabaseClient;

export type SlotFillOutcome =
  | "filled"
  | "alreadyFilled" // idempotent no-op (same competitor)
  | "replaced" // authorized correction replaced a still-mutable slot
  | "unresolved" // no unambiguous advancement yet (missing/ambiguous evidence)
  | "conflict" // slot holds a different competitor and replacement isn't allowed
  | "notPersistent"; // advancing competitor is race-only (cannot cross races)

export interface ProgressionResult {
  slotOutcomes: Array<{ slotId: string; destinationRaceId: string; outcome: SlotFillOutcome; competitorId?: string; reason?: string }>;
  winnerPublished?: string; // competitor id, if the final race completed the competition
  poolOutcomes?: Record<string, SettleRacePoolOutcome>;
}

interface PositionRow {
  competitor_id: string;
  position: number | null;
  finish_status: "FINISHED" | "DNF" | "DSQ" | "DID_NOT_START";
}

/**
 * Resolve the single competitor that advances from a source race under a rule.
 * Returns { competitorId } only when it is UNAMBIGUOUS from the current CONFIRMED
 * revision; otherwise { unresolved: reason } — never a guess.
 */
export async function resolveAdvancingCompetitor(
  client: Client,
  sourceRaceId: string,
  rule: "WINNER" | "POSITION",
  sourcePosition: number | null,
): Promise<{ competitorId: string } | { unresolved: string }> {
  const { data: result } = await client
    .from("race_results")
    .select("id, winner_competitor_id")
    .eq("race_id", sourceRaceId)
    .eq("status", "CONFIRMED")
    .maybeSingle();
  if (!result) return { unresolved: "SOURCE_NOT_CONFIRMED" };

  const { data: posData } = await client
    .from("race_result_positions")
    .select("competitor_id, position, finish_status")
    .eq("race_result_id", result.id);
  const positions = (posData ?? []) as PositionRow[];

  if (rule === "WINNER") {
    // A dead heat at position 1 makes "the winner" ambiguous — do not advance
    // (mirrors the grading gate). Otherwise the authoritative winner advances.
    const firsts = positions.filter((p) => p.finish_status === "FINISHED" && p.position === 1);
    if (firsts.length > 1) return { unresolved: "DEAD_HEAT_AT_FIRST" };
    return { competitorId: result.winner_competitor_id as string };
  }

  // POSITION: only an explicit, FINISHED, uniquely-held position advances.
  if (sourcePosition == null) return { unresolved: "NO_SOURCE_POSITION" };
  const atPosition = positions.filter((p) => p.finish_status === "FINISHED" && p.position === sourcePosition);
  if (atPosition.length === 0) return { unresolved: "POSITION_NOT_RECORDED" };
  if (atPosition.length > 1) return { unresolved: "DEAD_HEAT_AT_BOUNDARY" };
  return { competitorId: atPosition[0].competitor_id };
}

/** Fill one placeholder slot with an already-resolved competitor, safely. */
async function fillSlot(
  client: Client,
  slot: { id: string; race_id: string; competitor_id: string | null; is_placeholder: boolean },
  competitorId: string,
  allowReplace: boolean,
): Promise<{ outcome: SlotFillOutcome; reason?: string }> {
  // Idempotency / conflict on the target slot.
  if (!slot.is_placeholder && slot.competitor_id) {
    if (slot.competitor_id === competitorId) return { outcome: "alreadyFilled" };
    if (!allowReplace) return { outcome: "conflict", reason: "SLOT_HOLDS_DIFFERENT_COMPETITOR" };
  }

  // A race-only competitor cannot participate in a race other than its origin
  // (DB trigger enforces this); bracket competitors must be persistent.
  const { data: comp } = await client.from("competitors").select("is_persistent, created_for_race_id").eq("id", competitorId).maybeSingle();
  if (!comp || !comp.is_persistent || comp.created_for_race_id) return { outcome: "notPersistent", reason: "ADVANCING_COMPETITOR_NOT_PERSISTENT" };

  // The competitor must not already occupy another slot in the destination race
  // (would violate unique(race_id, competitor_id) and duplicate advancement).
  const { data: dupe } = await client
    .from("race_competitors")
    .select("id")
    .eq("race_id", slot.race_id)
    .eq("competitor_id", competitorId)
    .neq("id", slot.id)
    .limit(1)
    .maybeSingle();
  if (dupe) return { outcome: "conflict", reason: "COMPETITOR_ALREADY_IN_RACE" };

  const { error } = await client
    .from("race_competitors")
    .update({ competitor_id: competitorId, is_placeholder: false })
    .eq("id", slot.id);
  if (error) return { outcome: "conflict", reason: "FILL_REJECTED" };
  return { outcome: slot.competitor_id && slot.competitor_id !== competitorId ? "replaced" : "filled" };
}

/**
 * Process progression triggered by a source race whose result was just confirmed
 * (or corrected). Fills every downstream placeholder slot that references it and,
 * if the source race is the unique structurally-final race of a BRACKET/
 * ELIMINATION competition with an unambiguous winner, publishes the competition
 * winner and lets the existing settlement path run.
 *
 * allowReplace=true is used ONLY by an authorized correction after the caller has
 * verified every affected downstream object is still safely mutable
 * (assessDownstreamSafety); the normal forward path never overwrites.
 */
export async function processProgressionForRace(
  client: Client,
  sourceRaceId: string,
  opts: { allowReplace?: boolean; actorId?: string | null } = {},
): Promise<ProgressionResult> {
  const allowReplace = opts.allowReplace ?? false;
  const result: ProgressionResult = { slotOutcomes: [] };

  // Destination placeholder slots that advance FROM this source race.
  const { data: slots } = await client
    .from("race_competitors")
    .select("id, race_id, competitor_id, is_placeholder, source_rule, source_position")
    .eq("source_race_id", sourceRaceId);

  for (const slot of slots ?? []) {
    // A slot already filled with the same/derived competitor stays put; only a
    // slot expecting to advance from this source is (re)resolved.
    const rule = (slot.source_rule as "WINNER" | "POSITION" | null) ?? "WINNER";
    const resolved = await resolveAdvancingCompetitor(client, sourceRaceId, rule, slot.source_position ?? null);
    if ("unresolved" in resolved) {
      result.slotOutcomes.push({ slotId: slot.id, destinationRaceId: slot.race_id, outcome: "unresolved", reason: resolved.unresolved });
      continue;
    }
    const filled = await fillSlot(client, slot, resolved.competitorId, allowReplace);
    result.slotOutcomes.push({ slotId: slot.id, destinationRaceId: slot.race_id, outcome: filled.outcome, competitorId: resolved.competitorId, reason: filled.reason });
  }

  // Refresh stage status (safe derivation) for the source race's stage and any
  // affected destination stages — organizational only, never gates money.
  const stageIds = new Set<string>();
  const { data: srcRace } = await client.from("races").select("stage_id").eq("id", sourceRaceId).maybeSingle();
  if (srcRace?.stage_id) stageIds.add(srcRace.stage_id);
  for (const outcome of result.slotOutcomes) {
    const { data: destRace } = await client.from("races").select("stage_id").eq("id", outcome.destinationRaceId).maybeSingle();
    if (destRace?.stage_id) stageIds.add(destRace.stage_id);
  }
  for (const stageId of stageIds) await refreshStageStatus(client, stageId);

  // Publish the champion if this is the structurally-final race.
  const publication = await publishBracketWinnerIfFinal(client, sourceRaceId, opts.actorId ?? null);
  if (publication) {
    result.winnerPublished = publication.winnerCompetitorId;
    result.poolOutcomes = publication.poolOutcomes;
  }

  return result;
}

/**
 * If `raceId` is the UNIQUE structurally-final race of a BRACKET/ELIMINATION
 * competition and its current confirmed result has an unambiguous winner,
 * publish that winner (status -> COMPLETED) and settle the Competition Winner
 * pool via the existing adapter. Returns null when publication does not apply.
 */
export async function publishBracketWinnerIfFinal(
  client: Client,
  raceId: string,
  actorId: string | null,
): Promise<{ winnerCompetitorId: string; poolOutcomes: Record<string, SettleRacePoolOutcome> } | null> {
  const { data: race } = await client.from("races").select("id, competition_id").eq("id", raceId).maybeSingle();
  if (!race) return null;

  const { data: comp } = await client.from("racing_competitions").select("id, format, status").eq("id", race.competition_id).maybeSingle();
  if (!comp) return null;
  if (comp.format !== "BRACKET" && comp.format !== "ELIMINATION") return null; // only these formats auto-publish here

  // A terminal race feeds no downstream slot. Publish only when this race is the
  // UNIQUE terminal race of the competition (a well-formed single-elim final).
  const { data: raceRows } = await client.from("races").select("id").eq("competition_id", comp.id);
  const raceIds = (raceRows ?? []).map((r) => r.id);
  const { data: consumers } = await client.from("race_competitors").select("source_race_id").in("race_id", raceIds).not("source_race_id", "is", null);
  const consumedSourceIds = new Set((consumers ?? []).map((c) => c.source_race_id as string));
  const terminalRaceIds = raceIds.filter((id) => !consumedSourceIds.has(id));
  if (terminalRaceIds.length !== 1 || terminalRaceIds[0] !== raceId) return null; // not the unique final

  // Unambiguous winner of the final (dead heat -> no publish, manual review).
  const winner = await resolveAdvancingCompetitor(client, raceId, "WINNER", null);
  if ("unresolved" in winner) return null;
  const winnerCompetitorId = winner.competitorId;

  // Publish (optimistic status guard makes it idempotent; never overwrites a
  // COMPLETED competition here).
  await client
    .from("racing_competitions")
    .update({ status: "COMPLETED", winner_competitor_id: winnerCompetitorId })
    .eq("id", comp.id)
    .in("status", ["DRAFT", "ACTIVE"]);

  await writeAuditLog({
    actorId,
    action: "racing_competition.bracket_finalize",
    entityType: "racing_competition",
    entityId: comp.id,
    after: { winner_competitor_id: winnerCompetitorId, status: "COMPLETED", final_race_id: raceId, format: comp.format },
  });

  const poolOutcomes = await settleCompetitionPools(client, comp.id, winnerCompetitorId);
  return { winnerCompetitorId, poolOutcomes };
}

export interface DownstreamSafety {
  safe: boolean;
  blockedBy: Array<{ raceId: string; reasons: string[] }>;
}

const NON_MUTABLE_POOL_STATUSES = new Set([
  "LOCKED",
  "AWAITING_RESULT",
  "READY_FOR_REVIEW",
  "SETTLED",
  "MANUAL_REVIEW",
  "REVERSAL_FAILED_MANUAL_REVIEW",
  "SETTLEMENT_REVERSED",
  "VOIDED",
  "CANCELLED",
]);

/**
 * Can an upstream correction of `sourceRaceId` safely auto-rebuild its downstream
 * slots? Yes ONLY if every downstream race that advances from it is still fully
 * mutable: not started, no confirmed result, and carrying no pool that has moved
 * toward money (any non-OPEN pool, or any pool with entries — its per-competitor
 * options would be invalidated by a competitor swap). Any violation => STOP
 * automatic propagation and route to Super-Admin review (§3). This never reverses
 * or replays settled downstream state.
 */
export async function assessDownstreamSafety(client: Client, sourceRaceId: string): Promise<DownstreamSafety> {
  const { data: slots } = await client.from("race_competitors").select("race_id").eq("source_race_id", sourceRaceId);
  const downstreamRaceIds = [...new Set((slots ?? []).map((s) => s.race_id as string))];

  const blockedBy: Array<{ raceId: string; reasons: string[] }> = [];
  for (const rid of downstreamRaceIds) {
    const reasons: string[] = [];
    const { data: race } = await client.from("races").select("status").eq("id", rid).maybeSingle();
    if (race && race.status !== "SCHEDULED") reasons.push("downstream race has started");

    const { data: confirmed } = await client.from("race_results").select("id").eq("race_id", rid).eq("status", "CONFIRMED").maybeSingle();
    if (confirmed) reasons.push("downstream has a confirmed result");

    const { data: pools } = await client.from("pools").select("id, status").eq("race_id", rid);
    for (const p of pools ?? []) {
      if (NON_MUTABLE_POOL_STATUSES.has(p.status)) {
        reasons.push(`downstream pool ${p.status}`);
        continue;
      }
      const { data: opts } = await client.from("pool_options").select("entry_count").eq("pool_id", p.id);
      const entries = (opts ?? []).reduce((s, o) => s + (o.entry_count ?? 0), 0);
      // Any pool (even OPEN/empty) references the current slot occupants by
      // option; a competitor swap would desync it, so treat it as consumed.
      reasons.push(entries > 0 ? "downstream pool has entries" : "downstream pool exists");
    }

    if (reasons.length) blockedBy.push({ raceId: rid, reasons });
  }

  return { safe: blockedBy.length === 0, blockedBy };
}
