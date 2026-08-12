import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompetitionAccess } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOrganizerOrAbove } from "@/lib/auth/guards";
import { computeStandings } from "@/lib/racing/standings";
import { humanizeEnum } from "@/lib/utils/humanize";
import type { CompetitorIdentityData } from "@/components/racing/CompetitorIdentity";
import { StandingsTable } from "./standings-table";
import { FinalizeForm } from "./finalize-form";

// Competition detail + standings (Phase 7). Access re-checked server-side:
// requireCompetitionAccess enforces the Phase 3 assignment boundary (super_admin
// or an organizer assigned to THIS competition); players/legacy-admin denied.
export default async function CompetitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data: comp } = await admin
    .from("racing_competitions")
    .select("id, name, format, status, winner_competitor_id")
    .eq("id", id)
    .maybeSingle();
  if (!comp) notFound();

  const profile = await requireCompetitionAccess(comp.id);

  const [{ data: races }, standings] = await Promise.all([
    admin.from("races").select("id, title, status, race_number").eq("competition_id", id).order("race_number", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true }),
    computeStandings(admin, id),
  ]);

  // Resolve confirmed-result state per race (for the "needs result" hint).
  const raceIds = (races ?? []).map((r) => r.id);
  const confirmedByRace = new Set<string>();
  if (raceIds.length) {
    const { data: confirmed } = await admin.from("race_results").select("race_id").in("race_id", raceIds).eq("status", "CONFIRMED");
    for (const r of confirmed ?? []) confirmedByRace.add(r.race_id);
  }

  // Competitor identities for the standings rows.
  const competitorIds = standings.rows.map((r) => r.competitorId);
  const competitors = new Map<string, CompetitorIdentityData>();
  if (competitorIds.length) {
    const { data: rows } = await admin.from("competitors").select("id, name, number, colors, image_url").in("id", competitorIds);
    for (const c of rows ?? []) competitors.set(c.id, { name: c.name, number: c.number, colors: c.colors, imageUrl: c.image_url });
  }

  const isStandings = comp.format === "CHAMPIONSHIP" || comp.format === "LEAGUE";
  const canManage = isOrganizerOrAbove(profile);
  const eligibleToFinalize = isStandings && canManage && comp.status !== "COMPLETED" && comp.status !== "CANCELLED";

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{comp.name}</h1>
        <p className="text-sm text-text-secondary">
          {humanizeEnum(comp.format)} · {humanizeEnum(comp.status)}
          {comp.status === "ACTIVE" && standings.racesAwaitingResult > 0 && ` · ${standings.racesAwaitingResult} race(s) awaiting result`}
        </p>
      </div>

      {isStandings ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Standings</h2>
          <StandingsTable standings={standings} competitors={competitors} winnerCompetitorId={comp.winner_competitor_id} />
          {standings.ambiguous && (
            <p className="text-sm text-danger">A race has a tied finish that can&apos;t be scored automatically. It must be resolved before the competition can be finalized.</p>
          )}
          {!standings.ambiguous && standings.topTie && (
            <p className="text-sm text-text-secondary">The top of the standings is tied — there is no automatic champion.</p>
          )}
        </section>
      ) : (
        <p className="text-sm text-text-secondary">This is a {humanizeEnum(comp.format)} competition — it has no championship standings.</p>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Races ({(races ?? []).length})</h2>
          {canManage && <Link href="/racing/races/new" className="text-sm text-accent-primary hover:underline">New race</Link>}
        </div>
        {(races ?? []).length === 0 ? (
          <p className="text-sm text-text-secondary">No races yet.</p>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
            {(races ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <Link href={`/racing/races/${r.id}`} className="text-accent-primary hover:underline">{r.title ?? "Untitled race"}</Link>
                <span className="text-text-secondary">
                  {confirmedByRace.has(r.id) ? "Result confirmed" : humanizeEnum(r.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {eligibleToFinalize && (
        <section className="space-y-2 rounded-md border border-border-subtle p-3">
          <h2 className="text-sm font-semibold">Finalize</h2>
          <FinalizeForm competitionId={comp.id} eligible={eligibleToFinalize} />
        </section>
      )}
    </div>
  );
}
