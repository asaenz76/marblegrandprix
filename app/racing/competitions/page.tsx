import Link from "next/link";
import { requireOrganizerOrAbove } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/guards";
import { humanizeEnum } from "@/lib/utils/humanize";
import { Button } from "@/components/ui/button";

// Competitions index (Phase 7): scoped list -> competition standings/detail.
// Super Admin sees all; an organizer sees only assigned competitions.
export default async function CompetitionsPage() {
  const profile = await requireOrganizerOrAbove();
  const client = createAdminClient();

  let competitionIds: string[] | null = null; // null = unrestricted (super_admin)
  if (!isSuperAdmin(profile)) {
    const { data } = await client.from("competition_organizers").select("competition_id").eq("organizer_id", profile.id);
    competitionIds = (data ?? []).map((a) => a.competition_id);
  }

  let query = client
    .from("racing_competitions")
    .select("id, name, format, status, races(count)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (competitionIds !== null) query = query.in("id", competitionIds.length ? competitionIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: competitions } = await query;

  const superAdmin = isSuperAdmin(profile);
  const list = competitions ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Competitions</h1>
        {superAdmin && <Link href="/racing/competitions/new"><Button size="sm">New competition</Button></Link>}
      </div>

      {list.length === 0 ? (
        <div className="rounded-md border border-border-subtle p-4 text-center">
          <p className="text-sm text-text-secondary">No competitions you can manage yet.</p>
          {superAdmin && <Link href="/racing/competitions/new" className="mt-2 inline-block text-sm font-medium text-accent-primary hover:underline">Create your first competition →</Link>}
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
          {list.map((c) => {
            const count = (c.races as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
            return (
              <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <Link href={`/racing/competitions/${c.id}`} className="font-medium text-accent-primary hover:underline">{c.name}</Link>
                  <div className="text-xs text-text-secondary">{humanizeEnum(c.format)} · {count} race{count === 1 ? "" : "s"}</div>
                </div>
                <span className="shrink-0 text-xs text-text-secondary">{humanizeEnum(c.status)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
