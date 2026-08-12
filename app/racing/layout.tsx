import Link from "next/link";
import { requireOrganizerOrAbove } from "@/lib/auth/session";
import { AppShell } from "@/components/AppShell";
import { getAppShellProps } from "@/lib/app-shell-props";

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
        <nav aria-label="Racing" className="flex gap-1 border-b border-border-subtle">
          <Link href="/racing/races" className="border-b-2 border-transparent px-3 py-2 text-sm font-medium hover:border-border-strong">
            Races
          </Link>
        </nav>
        {children}
      </div>
    </AppShell>
  );
}
