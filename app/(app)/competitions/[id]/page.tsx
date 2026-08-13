import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { computeStandings } from "@/lib/racing/standings";
import { humanizeEnum } from "@/lib/utils/humanize";
import type { CompetitorIdentityData } from "@/components/racing/CompetitorIdentity";
import { StandingsTable } from "@/components/racing/StandingsTable";
import { BracketView } from "@/components/racing/BracketView";

/**
 * Player-facing, READ-ONLY competition detail (Phase 9). Reuses the Phase 7
 * standings computation and the Phase 8 bracket view — never a duplicate engine.
 * SINGLE_RACE lists its race(s); CHAMPIONSHIP/LEAGUE show standings;
 * BRACKET/ELIMINATION show the bracket (linking to player race pages). No
 * organizer controls (no finalize, no result entry, no new-race).
 */
export default async function PlayerCompetitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser();
  const supabase = await createClient();

  const { data: comp } = await supabase
    .from("racing_competitions")
    .select("id, name, format, status, winner_competitor_id")
    .eq("id", id)
    .maybeSingle();
  if (!comp) notFound();

  const isStandings = comp.format === "CHAMPIONSHIP" || comp.format === "LEAGUE";
  const isBracket = comp.format === "BRACKET" || comp.format === "ELIMINATION";

  const { data: races } = await supabase
    .from("races")
    .select("id, title, status")
    .eq("competition_id", id)
    .order("race_number", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  const standings = isStandings ? await computeStandings(supabase, id) : null;

  // Identities for the standings rows (and the champion).
  const competitors = new Map<string, CompetitorIdentityData>();
  const competitorIds = new Set<string>(standings?.rows.map((r) => r.competitorId) ?? []);
  if (comp.winner_competitor_id) competitorIds.add(comp.winner_competitor_id);
  if (competitorIds.size) {
    const { data: rows } = await supabase.from("competitors").select("id, name, number, colors, image_url").in("id", [...competitorIds]);
    for (const c of rows ?? []) competitors.set(c.id, { name: c.name, number: c.number, colors: c.colors, imageUrl: c.image_url });
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{comp.name}</h1>
        <p className="text-sm text-text-secondary">{humanizeEnum(comp.format)} · {humanizeEnum(comp.status)}</p>
      </div>

      {isStandings && standings ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Standings</h2>
          <StandingsTable standings={standings} competitors={competitors} winnerCompetitorId={comp.winner_competitor_id} />
          {standings.rows.length === 0 && <p className="text-sm text-text-secondary">No points yet — results will populate the standings.</p>}
        </section>
      ) : isBracket ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Bracket</h2>
          <BracketView competitionId={comp.id} raceBasePath="/races" />
          {comp.status === "COMPLETED" && <p className="text-sm text-success">Champion decided by the final race.</p>}
        </section>
      ) : (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Races</h2>
          {(races ?? []).length === 0 ? (
            <p className="text-sm text-text-secondary">No races yet.</p>
          ) : (
            <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
              {(races ?? []).map((r) => (
                <li key={r.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <Link href={`/races/${r.id}`} className="text-accent-primary hover:underline">{r.title ?? "Untitled race"}</Link>
                  <span className="text-text-secondary">{humanizeEnum(r.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
