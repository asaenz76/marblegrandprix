import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUsableSession, isSuperAdmin, isAdminOrAbove, isOrganizerOrAbove } from "./guards";
import { userCanManageCompetition } from "./racing";

export type UserProfile = {
  id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  // 'admin' is a LEGACY TECHNICAL role kept only for existing accounts — no new
  // product use, no racing authority (see lib/auth/guards.ts). Racing authority
  // is 'organizer' + a competition_organizers assignment.
  role: "super_admin" | "admin" | "organizer" | "player";
  is_active: boolean;
};

// cache()-wrapped so the layout, a page, and anything else calling
// requireUser()/requireAdminOrAbove()/requireSuperAdmin() within the same
// RSC render pass share one auth+profile lookup instead of each re-querying
// from scratch — proxy.ts's own middleware check is a separate phase of the
// request lifecycle and isn't affected by (or mergeable with) this.
export const getCurrentUser = cache(async (): Promise<UserProfile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id, display_name, username, avatar_url, role, is_active")
    .eq("id", user.id)
    .single();

  return profile as UserProfile | null;
});

export async function requireUser(): Promise<UserProfile> {
  const profile = await getCurrentUser();
  if (!isUsableSession(profile)) {
    redirect("/login");
  }
  return profile;
}

export async function requireSuperAdmin(): Promise<UserProfile> {
  const profile = await requireUser();
  if (!isSuperAdmin(profile)) {
    redirect("/feed");
  }
  return profile;
}

// LEGACY admin-panel page-level gate for the inherited (non-racing) admin
// surface — anything that isn't money movement or account/role management
// (those stay behind requireSuperAdmin()). This must NOT be used for racing
// (Organizer) authorization: use requireOrganizerOrAbove() + requireCompetitionAccess().
export async function requireAdminOrAbove(): Promise<UserProfile> {
  const profile = await requireUser();
  if (!isAdminOrAbove(profile)) {
    redirect("/feed");
  }
  return profile;
}

// Coarse eligibility gate for racing/Organizer actions: the user must be an
// organizer or super_admin (legacy 'admin' and players are rejected). This
// grants NO authority over any specific competition — every racing mutation
// must additionally call requireCompetitionAccess() (or userCanManage* from
// lib/auth/racing.ts) to check the competition_organizers assignment.
export async function requireOrganizerOrAbove(): Promise<UserProfile> {
  const profile = await requireUser();
  if (!isOrganizerOrAbove(profile)) {
    redirect("/feed");
  }
  return profile;
}

// The real racing authorization boundary: eligibility gate + per-competition
// assignment check. Super Admin passes for any competition; an organizer passes
// only for a competition they are assigned to. The assignment lookup uses the
// service-role client (authorization data is not client-readable) AFTER the
// caller has been authenticated — never a widened grant to authenticated.
export async function requireCompetitionAccess(competitionId: string): Promise<UserProfile> {
  const profile = await requireOrganizerOrAbove();
  const allowed = await userCanManageCompetition(createAdminClient(), profile, competitionId);
  if (!allowed) {
    redirect("/feed");
  }
  return profile;
}
