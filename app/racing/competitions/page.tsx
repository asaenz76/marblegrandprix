import Link from "next/link";
import { requireOrganizerOrAbove } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/guards";
import { humanizeEnum } from "@/lib/utils/humanize";

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

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Competitions</h1>

      {(competitions ?? []).length === 0 ? (
        <p className="text-sm text-text-secondary">No competitions you can manage yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border-subtle">
          <table className="w-full text-sm">
            <thead className="text-left text-text-secondary">
              <tr>
                <th className="px-3 py-2">Competition</th>
                <th className="px-3 py-2">Format</th>
                <th className="px-3 py-2">Races</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(competitions ?? []).map((c) => {
                const count = (c.races as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
                return (
                  <tr key={c.id} className="border-t border-border-subtle">
                    <td className="px-3 py-2"><Link href={`/racing/competitions/${c.id}`} className="text-accent-primary hover:underline">{c.name}</Link></td>
                    <td className="px-3 py-2 text-text-secondary">{humanizeEnum(c.format)}</td>
                    <td className="px-3 py-2 tabular-nums">{count}</td>
                    <td className="px-3 py-2 text-text-secondary">{humanizeEnum(c.status)}</td>
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
