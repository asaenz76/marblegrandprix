import { requireOrganizerOrAbove } from "@/lib/auth/session";
import { AppShell } from "@/components/AppShell";
import { getAppShellProps } from "@/lib/app-shell-props";
import { RacingNav } from "./racing-nav";

// Racing management section — accessible to Super Admins AND assigned
// Organizers (unlike /admin/*, which is requireAdminOrAbove and excludes
// organizers). Players and legacy 'admin' are redirected. Every mutation
// underneath still re-checks the per-competition assignment server-side.
export default async function RacingLayout({ children }: { children: React.ReactNode }) {
  const user = await requireOrganizerOrAbove();
  const { balanceCents, unreadNotificationCount, createHref } = await getAppShellProps(user);

  return (
    <AppShell user={user} balanceCents={balanceCents} unreadNotificationCount={unreadNotificationCount} createHref={createHref} wide>
      <div className="space-y-6">
        <RacingNav />
        {children}
      </div>
    </AppShell>
  );
}
