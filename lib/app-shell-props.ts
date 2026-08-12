import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin, isOrganizerOrAbove } from "@/lib/auth/guards";
import { getUnreadCount } from "@/lib/notifications/fetch";
import type { UserProfile } from "@/lib/auth/session";

/**
 * Shared AppShell (header/footer) data for every top-level layout — player
 * routes and admin routes alike, so the same header and bottom nav render
 * everywhere rather than the admin section growing its own separate shell.
 */
export async function getAppShellProps(user: UserProfile) {
  const supabase = await createClient();

  // Only super_admin sees the house account (platform fees collected
  // across all pools) — this stays super_admin-only specifically, not
  // "any staff role", since it's money-visibility, not admin-panel
  // content. 'admin' falls through to their own (always-empty)
  // personal wallet_balances row like a player would, which is harmless.
  const walletQuery =
    user.role === "super_admin"
      ? supabase.from("wallet_balances").select("balance").eq("account_type", "house").single()
      : supabase.from("wallet_balances").select("balance").eq("user_id", user.id).single();

  const [{ data: wallet }, unreadNotificationCount] = await Promise.all([
    walletQuery,
    getUnreadCount(user.id),
  ]);

  // Bottom nav's centered Create button routes to racing race creation for the
  // roles that can author races — Super Admins and (assignment-scoped)
  // Organizers. Players and legacy 'admin' get no center button. (The old
  // football pool wizard at /admin/pools/new is retired in Phase 4.)
  const createHref = isOrganizerOrAbove(user) ? "/racing/races/new" : null;

  return {
    balanceCents: wallet?.balance ?? 0,
    unreadNotificationCount,
    createHref,
  };
}
