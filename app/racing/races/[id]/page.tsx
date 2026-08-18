import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompetitionAccess } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRaceResultView } from "@/lib/racing/pool-presentation";
import { CompetitorIdentity } from "@/components/racing/CompetitorIdentity";
import { RaceResultSummary } from "@/components/racing/RaceResultSummary";
import { humanizeEnum } from "@/lib/utils/humanize";
import { CreateRacingPoolForm } from "@/components/racing/CreateRacingPoolForm";
import { RaceImageEditor } from "@/components/racing/RaceImageEditor";
import { CompetitorImageEditor } from "@/components/racing/CompetitorImageEditor";
import { DeleteRacingEntityButton } from "@/components/racing/DeleteRacingEntityButton";
import { ResultForm } from "./result-form";
import { CorrectionForm } from "./correction-form";

// Race detail + result entry (Phase 6). Access is re-checked server-side:
// requireCompetitionAccess enforces the Phase 3 assignment boundary (super_admin
// or an organizer assigned to THIS race's competition); players/legacy-admin denied.
export default async function RaceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data: race } = await admin.from("races").select("id, title, status, competition_id, scheduled_start_utc, image_url, racing_competitions(name)").eq("id", id).maybeSingle();
  if (!race) notFound();

  // Enforce per-competition authorization (redirects if not permitted).
  const profile = await requireCompetitionAccess(race.competition_id);

  const { data: rc } = await admin
    .from("race_competitors")
    .select("competitor_id, competitors ( id, name, number, colors, image_url )")
    .eq("race_id", id)
    .not("competitor_id", "is", null)
    .order("sort_order");
  const competitors = (rc ?? [])
    .map((r) => {
      const c = r.competitors as unknown as { id: string; name: string | null; number: string | null; colors: string[] | null; image_url: string | null };
      return c ? { id: c.id, name: c.name, number: c.number, colors: c.colors, imageUrl: c.image_url } : null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const { data: confirmed } = await admin.from("race_results").select("id, winner_competitor_id").eq("race_id", id).eq("status", "CONFIRMED").maybeSingle();
  const comp = race.racing_competitions as unknown as { name: string } | null;
  const canCorrect = isSuperAdmin(profile);
  const result = confirmed ? await getRaceResultView(id) : null;

  const { data: racePools } = await admin
    .from("pools")
    .select("id, status, visibility")
    .eq("race_id", id)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex items-center gap-3">
        {race.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={race.image_url} alt="" className="size-12 shrink-0 rounded-full object-cover" />
        )}
        <div>
          <h1 className="text-lg font-semibold">{race.title ?? "Race"}</h1>
          <p className="text-sm text-text-secondary">
            <Link href={`/racing/competitions/${race.competition_id}`} className="text-accent-primary hover:underline">{comp?.name}</Link>
            {" · "}{humanizeEnum(race.status)}
          </p>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Icon</h2>
        <RaceImageEditor raceId={race.id} imageUrl={race.image_url} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Competitors ({competitors.length})</h2>
        <ul className="space-y-2">
          {competitors.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3">
              <CompetitorIdentity competitor={c} />
              <CompetitorImageEditor raceId={id} competitorId={c.id} imageUrl={c.imageUrl} />
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Result</h2>
        {result ? (
          <>
            <RaceResultSummary result={result} />
            {canCorrect ? (
              <div className="pt-1"><CorrectionForm raceId={id} competitors={competitors} /></div>
            ) : (
              <p className="text-xs text-text-muted">A confirmed result is authoritative. Corrections are Super-Admin-only.</p>
            )}
          </>
        ) : (
          <ResultForm raceId={id} competitors={competitors} alreadyConfirmed={false} />
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Race Winner pools ({(racePools ?? []).length})</h2>
        {(racePools ?? []).length > 0 && (
          <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
            {(racePools ?? []).map((p) => (
              <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <Link href={`/pool/${p.id}`} className="text-accent-primary hover:underline">Race Winner pool</Link>
                <span className="text-text-secondary">
                  {p.visibility === "HIDDEN" ? "Hidden · " : ""}{humanizeEnum(p.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {competitors.length < 2 ? (
          <p className="text-sm text-text-secondary">Add at least 2 competitors to this race before creating a pool.</p>
        ) : (
          <CreateRacingPoolForm
            scope="RACE"
            raceId={id}
            contextLabel={race.title ?? "Race"}
            defaultLockIso={race.scheduled_start_utc ?? undefined}
          />
        )}
      </section>

      {canCorrect && (
        <section className="space-y-2 rounded-md border border-destructive/30 p-3">
          <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
          <DeleteRacingEntityButton kind="race" id={race.id} name={race.title ?? "Race"} />
        </section>
      )}
    </div>
  );
}
