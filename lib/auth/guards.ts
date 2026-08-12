import type { UserProfile } from "./session";

export function isUsableSession(profile: UserProfile | null): profile is UserProfile {
  return profile !== null && profile.is_active;
}

export function isSuperAdmin(profile: UserProfile): boolean {
  return profile.role === "super_admin";
}

// Coarse eligibility gate for racing (Organizer) actions: is this user even
// allowed to ATTEMPT organizer management? This is NOT authority over any
// specific competition — the per-competition assignment check
// (userCanManageCompetition, lib/auth/racing.ts) is the real boundary.
// Deliberately excludes legacy 'admin': an admin gains NO racing authority
// here (see isAdminOrAbove's note). Only 'organizer' and 'super_admin' clear it.
export function isOrganizerOrAbove(profile: UserProfile): boolean {
  return profile.role === "super_admin" || profile.role === "organizer";
}

// LEGACY TECHNICAL ROLE gate — 'admin' is a pre-racing, lower-privileged role:
// full admin-panel visibility minus money movement (wallet/settlement/reversal)
// and account/role management, which stay gated by isSuperAdmin() specifically.
// It is NOT part of the racing product role model and must NEVER be used for
// racing (Organizer) authorization — use isOrganizerOrAbove() + the assignment
// check instead. 'admin' is never treated as super_admin, and no new users are
// assigned it (lib/validations/users.ts permits only player/organizer).
export function isAdminOrAbove(profile: UserProfile): boolean {
  return profile.role === "super_admin" || profile.role === "admin";
}
