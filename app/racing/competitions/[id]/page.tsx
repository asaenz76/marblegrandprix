import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompetitionAccess } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOrganizerOrAbove, isSuperAdmin } from "@/lib/auth/guards";
import { computeStandings, type StandingsResult } from "@/lib/racing/standings";
import { humanizeEnum } from "@/lib/utils/humanize";
import type { CompetitorIdentityData } from "@/components/racing/CompetitorIdentity";
import { StandingsTable } from "@/components/racing/StandingsTable";
import { FinalizeForm } from "./finalize-form";
import { BracketView } from "@/components/racing/BracketView";
import { CreateRacingPoolForm } from "@/components/racing/CreateRacingPoolForm";
import { CompetitionImageEditor } from "@/components/racing/CompetitionImageEditor";
import { CompetitionNameEditor } from "@/components/racing/CompetitionNameEditor";
import { DeleteRacingEntityButton } from "@/components/racing/DeleteRacingEntityButton";
import { PointsEditor } from "@/components/racing/PointsEditor";
import { LocalDateTime } from "@/components/LocalDateTime";
import { OrganizersSection } from "./organizers-section";
import { BoldFormSurface } from "@/components/ui/bold-form-surface";

// Competition detail + standings (Phase 7). Access re-checked server-side:
// requireCompetitionAccess enforces the Phase 3 assignment boundary (super_admin
// or an organizer assigned to THIS competition); players/legacy-admin denied.
export default async function CompetitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data: comp } = await admin
    .from("racing_competitions")
    .select("id, name, format, status, winner_competitor_id, image_url, points_config")
    .eq("id", id)
    .maybeSingle();
  if (!comp) notFound();

  const profile = await requireCompetitionAccess(comp.id);

  const isStandings = comp.format === "CHAMPIONSHIP" || comp.format === "LEAGUE";
  const isBracket = comp.format === "BRACKET" || comp.format === "ELIMINATION";

  const { data: races } = await admin.from("races").select("id, title, status, race_number, scheduled_start_utc").eq("competition_id", id).order("race_number", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true });

  const { data: compPools } = await admin
    .from("pools")
    .select("id, status, visibility")
    .eq("template_id", "COMPETITION_WINNER")
    .eq("template_config->>competition_id", id)
    .order("created_at", { ascending: false });

  // Standings are only meaningful for CHAMPIONSHIP/LEAGUE.
  const standings: StandingsResult | null = isStandings ? await computeStandings(admin, id) : null;

  // Resolve confirmed-result state per race (for the "needs result" hint).
  const raceIds = (races ?? []).map((r) => r.id);
  const confirmedByRace = new Set<string>();
  if (raceIds.length) {
    const { data: confirmed } = await admin.from("race_results").select("race_id").in("race_id", raceIds).eq("status", "CONFIRMED");
    for (const r of confirmed ?? []) confirmedByRace.add(r.race_id);
  }

  // Competitor identities for the standings rows.
  const competitors = new Map<string, CompetitorIdentityData>();
  const competitorIds = standings?.rows.map((r) => r.competitorId) ?? [];
  if (competitorIds.length) {
    const { data: rows } = await admin.from("competitors").select("id, name, number, colors, image_url").in("id", competitorIds);
    for (const c of rows ?? []) competitors.set(c.id, { name: c.name, number: c.number, colors: c.colors, imageUrl: c.image_url });
  }

  // Bracket/elimination competitions publish the winner automatically from the
  // final race, so they expose no manual "Finalize" control.
  const canManage = isOrganizerOrAbove(profile);
  const eligibleToFinalize = isStandings && canManage && comp.status !== "COMPLETED" && comp.status !== "CANCELLED";
  const addRaceHref = `/racing/races/new?competition=${comp.id}`;

  // Organizer assignment (Super-Admin only): assigned organizers + assignable ones.
  const superAdmin = isSuperAdmin(profile);
  const assignedOrganizers: { id: string; name: string }[] = [];
  const assignableOrganizers: { id: string; name: string }[] = [];
  if (superAdmin) {
    const { data: assignedRows } = await admin.from("competition_organizers").select("organizer_id").eq("competition_id", comp.id);
    const assignedIds = new Set((assignedRows ?? []).map((r) => r.organizer_id as string));
    const { data: orgUsers } = await admin.from("user_profiles").select("id, display_name").eq("role", "organizer").eq("is_active", true).order("display_name");
    for (const u of orgUsers ?? []) {
      const person = { id: u.id, name: u.display_name };
      if (assignedIds.has(u.id)) assignedOrganizers.push(person);
      else assignableOrganizers.push(person);
    }
  }

  return (
    <BoldFormSurface className="mx-auto max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        {comp.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={comp.image_url} alt="" className="size-12 shrink-0 rounded-full object-cover" />
        )}
        <div>
          <h1 className="text-lg font-semibold">{comp.name}</h1>
          <p className="text-sm text-text-secondary">
            {humanizeEnum(comp.format)} · {humanizeEnum(comp.status)}
            {isStandings && comp.status === "ACTIVE" && standings!.racesAwaitingResult > 0 && ` · ${standings!.racesAwaitingResult} race(s) awaiting result`}
          </p>
        </div>
      </div>

      {canManage && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Name</h2>
          <CompetitionNameEditor competitionId={comp.id} name={comp.name} />
        </section>
      )}

      {canManage && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Icon</h2>
          <CompetitionImageEditor competitionId={comp.id} imageUrl={comp.image_url} />
        </section>
      )}

      {canManage && isStandings && (
        <section className="space-y-2 rounded-md border border-border-subtle p-3">
          <h2 className="text-sm font-semibold">Championship points</h2>
          <p className="text-xs text-text-secondary">
            Points awarded per finishing position across the season. Standings use these live.
          </p>
          <PointsEditor competitionId={comp.id} pointsConfig={(comp.points_config as Record<string, number>) ?? {}} />
        </section>
      )}

      {isStandings && standings ? (
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
      ) : isBracket ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Bracket</h2>
            {canManage && comp.status !== "COMPLETED" && <Link href={addRaceHref} className="text-sm text-accent-primary hover:underline">Add race</Link>}
          </div>
          <BracketView competitionId={comp.id} />
          {comp.status === "COMPLETED" && <p className="text-sm text-success">Champion decided by the final race.</p>}
        </section>
      ) : (
        <p className="text-sm text-text-secondary">This is a {humanizeEnum(comp.format)} competition.</p>
      )}

      <section className={`space-y-2 ${isBracket ? "hidden" : ""}`}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Races ({(races ?? []).length})</h2>
          {canManage && <Link href={addRaceHref} className="text-sm text-accent-primary hover:underline">Add race</Link>}
        </div>
        {(races ?? []).length === 0 ? (
          <p className="text-sm text-text-secondary">No races yet.</p>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
            {(races ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <Link href={`/racing/races/${r.id}`} className="text-accent-primary hover:underline">{r.title ?? "Untitled race"}</Link>
                  <p className="text-xs text-text-muted">
                    {r.scheduled_start_utc ? (
                      <LocalDateTime iso={r.scheduled_start_utc} options={{ dateStyle: "medium", timeStyle: "short" }} />
                    ) : (
                      "No date set"
                    )}
                  </p>
                </div>
                <span className="shrink-0 text-text-secondary">
                  {confirmedByRace.has(r.id) ? "Result confirmed" : humanizeEnum(r.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Competition Winner pool ({(compPools ?? []).length})</h2>
        {(compPools ?? []).length > 0 && (
          <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
            {(compPools ?? []).map((p) => (
              <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <Link href={`/pool/${p.id}`} className="text-accent-primary hover:underline">Competition Winner pool</Link>
                <span className="text-text-secondary">
                  {p.visibility === "HIDDEN" ? "Hidden · " : ""}{humanizeEnum(p.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canManage &&
          ((races ?? []).length === 0 ? (
            <p className="text-sm text-text-secondary">
              Add races and competitors before creating a Competition Winner pool.
            </p>
          ) : (
            <CreateRacingPoolForm scope="COMPETITION" competitionId={comp.id} contextLabel={comp.name} />
          ))}
      </section>

      {eligibleToFinalize && (
        <section className="space-y-2 rounded-md border border-border-subtle p-3">
          <h2 className="text-sm font-semibold">Finalize</h2>
          <FinalizeForm competitionId={comp.id} eligible={eligibleToFinalize} />
        </section>
      )}

      {superAdmin && (
        <OrganizersSection competitionId={comp.id} assigned={assignedOrganizers} assignable={assignableOrganizers} />
      )}

      {superAdmin && (
        <section className="space-y-2 rounded-md border border-destructive/30 p-3">
          <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
          <DeleteRacingEntityButton kind="competition" id={comp.id} name={comp.name} />
        </section>
      )}
    </BoldFormSurface>
  );
}
