import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile } from "./session";
import { isSuperAdmin, isOrganizerOrAbove } from "./guards";

export { isOrganizerOrAbove };

/**
 * Racing (Organizer) authorization — the invariant of Phase 3.
 *
 * Authentication tells us WHO the user is; competition ASSIGNMENT tells us what
 * an Organizer may manage. Only super_admin has global authority.
 *
 * The authorization decision is:
 *
 *     canManage = is_super_admin(user)
 *                 OR (user.role === 'organizer'
 *                     AND EXISTS competition_organizers(competition, user))
 *
 * It is enforced entirely server-side (Server Action) using a service-role
 * client — NEVER by widening an RPC/RLS grant to authenticated. Legacy 'admin'
 * fails the role gate and holds no assignment, so it gets no racing authority.
 *
 * These functions take an explicit Supabase client so they are unit/integration
 * testable and callable from any server context; production passes the
 * service-role client (createAdminClient()) after the Server Action has already
 * authenticated the caller.
 */

/** Does this user have management authority over the given competition? */
export async function userCanManageCompetition(
  client: SupabaseClient,
  profile: UserProfile,
  competitionId: string,
): Promise<boolean> {
  if (isSuperAdmin(profile)) return true;
  // A stale assignment row must not grant authority to a demoted user, so the
  // current role gate comes first — legacy 'admin' and 'player' fail here.
  if (profile.role !== "organizer") return false;
  const { data } = await client
    .from("competition_organizers")
    .select("competition_id")
    .eq("competition_id", competitionId)
    .eq("organizer_id", profile.id)
    .maybeSingle();
  return data !== null;
}

/** A reference to some racing object, identified by exactly one id. */
export type RacingRef = {
  competitionId?: string;
  stageId?: string;
  raceId?: string;
  raceCompetitorId?: string;
  raceResultId?: string;
  raceResultPositionId?: string;
};

/**
 * Walk a descendant racing object back to its owning competition. Assignment is
 * held only at the competition level; descendants (stages/races/competitors/
 * results/positions) resolve ownership through their parent competition — no
 * separate per-descendant assignment, and no nested branch hierarchy.
 */
export async function resolveOwningCompetition(
  client: SupabaseClient,
  ref: RacingRef,
): Promise<string | null> {
  if (ref.competitionId) return ref.competitionId;

  if (ref.stageId) {
    const { data } = await client
      .from("competition_stages")
      .select("competition_id")
      .eq("id", ref.stageId)
      .maybeSingle();
    return (data?.competition_id as string | undefined) ?? null;
  }

  if (ref.raceId) {
    const { data } = await client
      .from("races")
      .select("competition_id")
      .eq("id", ref.raceId)
      .maybeSingle();
    return (data?.competition_id as string | undefined) ?? null;
  }

  // race_competitors / race_results / race_result_positions all hang off a race.
  let raceId: string | null = null;
  if (ref.raceCompetitorId) {
    const { data } = await client.from("race_competitors").select("race_id").eq("id", ref.raceCompetitorId).maybeSingle();
    raceId = (data?.race_id as string | undefined) ?? null;
  } else if (ref.raceResultId) {
    const { data } = await client.from("race_results").select("race_id").eq("id", ref.raceResultId).maybeSingle();
    raceId = (data?.race_id as string | undefined) ?? null;
  } else if (ref.raceResultPositionId) {
    const { data } = await client.from("race_result_positions").select("race_id").eq("id", ref.raceResultPositionId).maybeSingle();
    raceId = (data?.race_id as string | undefined) ?? null;
  }
  if (!raceId) return null;
  return resolveOwningCompetition(client, { raceId });
}

/** Can this user manage the given descendant object (resolved to its competition)? */
export async function userCanManageDescendant(
  client: SupabaseClient,
  profile: UserProfile,
  ref: RacingRef,
): Promise<boolean> {
  const competitionId = await resolveOwningCompetition(client, ref);
  if (!competitionId) return false;
  return userCanManageCompetition(client, profile, competitionId);
}
