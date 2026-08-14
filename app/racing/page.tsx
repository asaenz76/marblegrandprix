import Link from "next/link";
import { requireOrganizerOrAbove } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOperatorHome } from "@/lib/racing/operator-home";
import { LocalDateTime } from "@/components/LocalDateTime";
import { Button } from "@/components/ui/button";

/**
 * Racing operator home (Phase 10 UX). A small, actionable landing — not a
 * dashboard: what needs a result, what's ready to finalize / in review, what's
 * coming up, and the two create actions. Scoped to what the operator manages.
 */
export default async function RacingHomePage() {
  const profile = await requireOrganizerOrAbove();
  const admin = createAdminClient();
  const home = await getOperatorHome(admin, profile);
  const superAdmin = isSuperAdmin(profile);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Racing</h1>
        <div className="flex gap-2">
          <Link href="/racing/races/new"><Button size="sm">New race</Button></Link>
          {superAdmin && <Link href="/racing/competitions/new"><Button size="sm" variant="outline">New competition</Button></Link>}
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Awaiting result ({home.awaitingResult.length})</h2>
        {home.awaitingResult.length === 0 ? (
          <p className="text-sm text-text-secondary">No races are waiting for a result right now.</p>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
            {home.awaitingResult.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <Link href={`/racing/races/${r.id}`} className="font-medium text-accent-primary hover:underline">{r.title ?? "Untitled race"}</Link>
                  <div className="text-xs text-text-secondary">{r.competitionName}{r.scheduledStartUtc && <> · <LocalDateTime iso={r.scheduledStartUtc} options={{ dateStyle: "medium", timeStyle: "short" }} /></>}</div>
                </div>
                <Link href={`/racing/races/${r.id}`} className="shrink-0 text-xs font-medium text-accent-primary hover:underline">Enter result →</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {home.needsAttention.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Needs attention ({home.needsAttention.length})</h2>
          <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
            {home.needsAttention.map((c, i) => (
              <li key={`${c.id}-${i}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <Link href={`/racing/competitions/${c.id}`} className="font-medium text-accent-primary hover:underline">{c.name}</Link>
                  <div className="text-xs text-text-secondary">{c.reason}</div>
                </div>
                <Link href={`/racing/competitions/${c.id}`} className="shrink-0 text-xs font-medium text-accent-primary hover:underline">Open →</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {home.upcoming.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Upcoming races</h2>
          <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
            {home.upcoming.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <Link href={`/racing/races/${r.id}`} className="font-medium text-accent-primary hover:underline">{r.title ?? "Untitled race"}</Link>
                {r.scheduledStartUtc && <span className="shrink-0 text-xs text-text-secondary"><LocalDateTime iso={r.scheduledStartUtc} options={{ dateStyle: "medium", timeStyle: "short" }} /></span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {home.competitionCount === 0 && home.raceCount === 0 && (
        <div className="rounded-md border border-border-subtle p-4 text-center">
          <p className="text-sm text-text-secondary">Nothing here yet.</p>
          <p className="mt-1 text-sm text-text-secondary">{superAdmin ? "Create a competition or a standalone race to get started." : "Races you're assigned to manage will appear here."}</p>
        </div>
      )}

      <nav className="flex gap-4 text-sm">
        <Link href="/racing/competitions" className="text-accent-primary hover:underline">All competitions ({home.competitionCount})</Link>
        <Link href="/racing/races" className="text-accent-primary hover:underline">All races ({home.raceCount})</Link>
      </nav>
    </div>
  );
}
