"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { assignOrganizerToCompetition, removeOrganizerFromCompetition } from "@/lib/actions/organizers";
import { Button } from "@/components/ui/button";

type Person = { id: string; name: string };

/**
 * Super-Admin-only organizer assignment (Phase 10 UX over Phase 3 actions).
 * Lists assigned organizers, assigns another organizer-role user, and removes an
 * assignment (which revokes future management authority). It calls the existing
 * requireSuperAdmin-gated server actions — no access is broadened here.
 */
export function OrganizersSection({ competitionId, assigned, assignable }: { competitionId: string; assigned: Person[]; assignable: Person[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pick, setPick] = useState(assignable[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <section className="space-y-2 rounded-md border border-border-subtle p-3">
      <h2 className="text-sm font-semibold">Organizers</h2>
      <p className="text-xs text-text-secondary">Organizers can manage this competition&apos;s races and results. Only a Super Admin can change this.</p>

      {assigned.length === 0 ? (
        <p className="text-sm text-text-secondary">No organizers assigned yet.</p>
      ) : (
        <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
          {assigned.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>{o.name}</span>
              <button type="button" aria-label={`Remove ${o.name}`} disabled={pending} onClick={() => run(() => removeOrganizerFromCompetition(competitionId, o.id))} className="rounded p-1 text-text-secondary hover:bg-surface-secondary disabled:opacity-40">
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {assignable.length > 0 ? (
        <div className="flex items-center gap-2">
          <select className="flex-1 rounded-md border border-border-subtle bg-transparent px-3 py-2 text-sm" value={pick} onChange={(e) => setPick(e.target.value)}>
            {assignable.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <Button type="button" size="sm" disabled={pending || !pick} onClick={() => run(() => assignOrganizerToCompetition(competitionId, pick))}>Assign</Button>
        </div>
      ) : (
        <p className="text-xs text-text-muted">Everyone with the Organizer role is already assigned. Grant the Organizer role from the Admin → Users page first.</p>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
    </section>
  );
}
