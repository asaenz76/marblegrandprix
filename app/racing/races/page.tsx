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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Races</h1>
        <Link href="/racing/races/new"><Button size="sm">New race</Button></Link>
      </div>

      {(races ?? []).length === 0 ? (
        <p className="text-sm text-text-secondary">No races yet. Create your first one.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border-subtle">
          <table className="w-full text-sm">
            <thead className="text-left text-text-secondary">
              <tr>
                <th className="px-3 py-2">Race</th>
                <th className="px-3 py-2">Competition</th>
                <th className="px-3 py-2">Competitors</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(races ?? []).map((r) => {
                const comp = r.racing_competitions as unknown as { name: string } | null;
                const count = (r.race_competitors as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
                return (
                  <tr key={r.id} className="border-t border-border-subtle">
                    <td className="px-3 py-2"><Link href={`/racing/races/${r.id}`} className="text-accent-primary hover:underline">{r.title ?? "Untitled race"}</Link></td>
                    <td className="px-3 py-2 text-text-secondary">{comp?.name ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{count}</td>
                    <td className="px-3 py-2 text-text-secondary">{humanizeEnum(r.status)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
