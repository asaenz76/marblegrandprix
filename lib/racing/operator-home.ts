import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/guards";

/**
 * Read-only data for the racing operator home (Phase 10 UX). Surfaces the small
 * set of genuinely actionable states an operator should see at a glance —
 * scoped to what they may manage (Super Admin: everything; Organizer: assigned
 * competitions only). Pure reads; no money, no new rules, no analytics.
 */

export interface OperatorRaceRow {
  id: string;
  title: string | null;
  competitionName: string | null;
  scheduledStartUtc: string | null;
}
export interface OperatorCompetitionRow {
  id: string;
  name: string;
  format: string;
  reason: string; // plain-language why it needs attention
}
export interface OperatorHome {
  awaitingResult: OperatorRaceRow[];
  needsAttention: OperatorCompetitionRow[];
  upcoming: OperatorRaceRow[];
  competitionCount: number;
  raceCount: number;
}

/** Competition ids this operator may manage; null = unrestricted (super admin). */
async function scopedCompetitionIds(client: SupabaseClient, actor: UserProfile): Promise<string[] | null> {
  if (isSuperAdmin(actor)) return null;
  const { data } = await client.from("competition_organizers").select("competition_id").eq("organizer_id", actor.id);
  return (data ?? []).map((r) => r.competition_id as string);
}

export async function getOperatorHome(client: SupabaseClient, actor: UserProfile): Promise<OperatorHome> {
  const compIds = await scopedCompetitionIds(client, actor);
  const empty: OperatorHome = { awaitingResult: [], needsAttention: [], upcoming: [], competitionCount: 0, raceCount: 0 };
  if (compIds !== null && compIds.length === 0) return empty;

  // Competitions in scope.
  let compQuery = client.from("racing_competitions").select("id, name, format, status").order("created_at", { ascending: false });
  if (compIds !== null) compQuery = compQuery.in("id", compIds);
  const { data: comps } = await compQuery;
  const competitions = comps ?? [];
  const nameById = new Map(competitions.map((c) => [c.id, c.name as string]));

  // Races in scope + their confirmed-result state.
  let raceQuery = client
    .from("races")
    .select("id, title, status, scheduled_start_utc, competition_id")
    .order("scheduled_start_utc", { ascending: true, nullsFirst: false })
    .limit(200);
  if (compIds !== null) raceQuery = raceQuery.in("competition_id", compIds.length ? compIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: raceRows } = await raceQuery;
  const races = raceRows ?? [];

  const raceIds = races.map((r) => r.id);
  const confirmed = new Set<string>();
  if (raceIds.length) {
    const { data: results } = await client.from("race_results").select("race_id").in("race_id", raceIds).eq("status", "CONFIRMED");
    for (const r of results ?? []) confirmed.add(r.race_id as string);
  }

  const liveStatuses = new Set(["SCHEDULED", "IN_PROGRESS"]);
  const awaitingResult: OperatorRaceRow[] = races
    .filter((r) => liveStatuses.has(r.status) && !confirmed.has(r.id))
    .slice(0, 8)
    .map((r) => ({ id: r.id, title: r.title, competitionName: nameById.get(r.competition_id) ?? null, scheduledStartUtc: r.scheduled_start_utc }));

  const upcoming: OperatorRaceRow[] = races
    .filter((r) => r.status === "SCHEDULED" && r.scheduled_start_utc)
    .slice(0, 5)
    .map((r) => ({ id: r.id, title: r.title, competitionName: nameById.get(r.competition_id) ?? null, scheduledStartUtc: r.scheduled_start_utc }));

  // Competitions needing attention: standings-format ACTIVE competitions whose
  // races are all confirmed (ready to finalize), and any pool in manual review.
  const needsAttention: OperatorCompetitionRow[] = [];
  const racesByComp = new Map<string, { id: string; status: string }[]>();
  for (const r of races) {
    const list = racesByComp.get(r.competition_id) ?? [];
    list.push({ id: r.id, status: r.status });
    racesByComp.set(r.competition_id, list);
  }
  for (const c of competitions) {
    if (c.status !== "ACTIVE") continue;
    const isStandings = c.format === "CHAMPIONSHIP" || c.format === "LEAGUE";
    if (!isStandings) continue;
    const list = (racesByComp.get(c.id) ?? []).filter((r) => r.status !== "CANCELLED" && r.status !== "ABANDONED");
    if (list.length > 0 && list.every((r) => confirmed.has(r.id))) {
      needsAttention.push({ id: c.id, name: c.name, format: c.format, reason: "All races have results — ready to finalize." });
    }
  }

  // Pools in manual review on in-scope races/competitions.
  const compIdList = competitions.map((c) => c.id);
  if (compIdList.length) {
    const { data: reviewPools } = await client
      .from("pools")
      .select("id, race_id, template_config")
      .eq("status", "MANUAL_REVIEW")
      .in("template_id", ["RACE_WINNER", "COMPETITION_WINNER"]);
    for (const p of reviewPools ?? []) {
      const compId = (p.template_config?.competition_id as string | undefined) ?? (p.race_id ? races.find((r) => r.id === p.race_id)?.competition_id : undefined);
      if (compId && nameById.has(compId) && !needsAttention.some((n) => n.id === compId && n.reason.includes("review"))) {
        needsAttention.push({ id: compId, name: nameById.get(compId)!, format: competitions.find((c) => c.id === compId)?.format ?? "", reason: "A pool needs manual review." });
      }
    }
  }

  return {
    awaitingResult,
    needsAttention,
    upcoming,
    competitionCount: competitions.length,
    raceCount: races.length,
  };
}
