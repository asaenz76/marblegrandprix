import Link from "next/link";
import { requireOrganizerOrAbove } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/guards";
import { Button } from "@/components/ui/button";
import { humanizeEnum } from "@/lib/utils/humanize";

// Minimal races index (Phase 4): scoped list + entry point to create a race.
export default async function RacesPage() {
  const profile = await requireOrganizerOrAbove();
  const client = createAdminClient();

  let competitionIds: string[] | null = null; // null = unrestricted (super_admin)
  if (!isSuperAdmin(profile)) {
    const { data } = await client.from("competition_organizers").select("competition_id").eq("organizer_id", profile.id);
    competitionIds = (data ?? []).map((a) => a.competition_id);
  }

  let query = client
    .from("races")
    .select("id, title, status, scheduled_start_utc, racing_competitions(name), race_competitors(count)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (competitionIds !== null) query = query.in("competition_id", competitionIds.length ? competitionIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: races } = await query;
  const list = races ?? [];

  // Confirmed-result state, so the list can show "Awaiting result" vs "Result confirmed".
  const confirmed = new Set<string>();
  if (list.length) {
    const { data: results } = await client.from("race_results").select("race_id").in("race_id", list.map((r) => r.id)).eq("status", "CONFIRMED");
    for (const r of results ?? []) confirmed.add(r.race_id as string);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Races</h1>
        <Link href="/racing/races/new"><Button size="sm">New race</Button></Link>
      </div>

      {list.length === 0 ? (
        <div className="rounded-md border border-border-subtle p-4 text-center">
          <p className="text-sm text-text-secondary">No races yet.</p>
          <Link href="/racing/races/new" className="mt-2 inline-block text-sm font-medium text-accent-primary hover:underline">Create your first race →</Link>
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
          {list.map((r) => {
            const comp = r.racing_competitions as unknown as { name: string } | null;
            const count = (r.race_competitors as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
            const awaiting = !confirmed.has(r.id) && (r.status === "SCHEDULED" || r.status === "IN_PROGRESS");
            return (
              <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <Link href={`/racing/races/${r.id}`} className="font-medium text-accent-primary hover:underline">{r.title ?? "Untitled race"}</Link>
                  <div className="text-xs text-text-secondary">{comp?.name ?? "—"} · {count} competitor{count === 1 ? "" : "s"}</div>
                </div>
                <span className={`shrink-0 text-xs ${awaiting ? "font-medium text-accent-primary" : "text-text-secondary"}`}>
                  {confirmed.has(r.id) ? "Result confirmed" : awaiting ? "Awaiting result" : humanizeEnum(r.status)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
