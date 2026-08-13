import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getRaceResultView } from "@/lib/racing/pool-presentation";
import { CompetitorIdentity, type CompetitorIdentityData } from "@/components/racing/CompetitorIdentity";
import { RaceResultSummary } from "@/components/racing/RaceResultSummary";
import { LocalDateTime } from "@/components/LocalDateTime";
import { humanizeEnum } from "@/lib/utils/humanize";

/**
 * Player-facing, READ-ONLY race detail (Phase 9). Any authenticated member can
 * read racing data (Phase 2 RLS); this page shows the race, its competition, the
 * field, the truthful confirmed result, and any pools on the race — with NO
 * result-entry, correction, progression, or organizer controls. The organizer
 * surface lives under /racing and stays server-authorized separately.
 */
export default async function PlayerRacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser();
  const supabase = await createClient();

  const { data: race } = await supabase
    .from("races")
    .select("id, title, status, scheduled_start_utc, competition_id, racing_competitions(name, format)")
    .eq("id", id)
    .maybeSingle();
  if (!race) notFound();

  const comp = (Array.isArray(race.racing_competitions) ? race.racing_competitions[0] : race.racing_competitions) as
    | { name: string; format: string }
    | null;

  const [{ data: rc }, result, { data: pools }] = await Promise.all([
    supabase
      .from("race_competitors")
      .select("competitor_id, is_placeholder, sort_order, competitors ( id, name, number, colors, image_url )")
      .eq("race_id", id)
      .order("sort_order"),
    getRaceResultView(id),
    supabase.from("pools").select("id, question, status").eq("race_id", id).neq("status", "DRAFT"),
  ]);

  const competitors = (rc ?? [])
    .filter((r) => !r.is_placeholder && r.competitor_id)
    .map((r) => {
      const c = (Array.isArray(r.competitors) ? r.competitors[0] : r.competitors) as
        | { id: string; name: string | null; number: string | null; colors: string[] | null; image_url: string | null }
        | null;
      return c ? ({ name: c.name, number: c.number, colors: c.colors, imageUrl: c.image_url } as CompetitorIdentityData) : null;
    })
    .filter((c): c is CompetitorIdentityData => c != null);
  const placeholderCount = (rc ?? []).filter((r) => r.is_placeholder).length;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{race.title ?? "Race"}</h1>
        <p className="text-sm text-text-secondary">
          {race.competition_id && comp ? (
            <Link href={`/competitions/${race.competition_id}`} className="text-accent-primary hover:underline">{comp.name}</Link>
          ) : null}
          {" · "}
          {humanizeEnum(race.status)}
          {race.scheduled_start_utc && (
            <> · <LocalDateTime iso={race.scheduled_start_utc} options={{ dateStyle: "medium", timeStyle: "short" }} /></>
          )}
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Competitors ({competitors.length})</h2>
        {competitors.length === 0 ? (
          <p className="text-sm text-text-secondary">Competitors haven&apos;t been set yet.</p>
        ) : (
          <ul className="space-y-1">
            {competitors.map((c, i) => (
              <li key={i} className="text-sm"><CompetitorIdentity competitor={c} /></li>
            ))}
          </ul>
        )}
        {placeholderCount > 0 && (
          <p className="text-xs text-text-muted">{placeholderCount} spot{placeholderCount === 1 ? "" : "s"} still to be decided by earlier races.</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Result</h2>
        <RaceResultSummary result={result} />
      </section>

      {(pools ?? []).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Pools</h2>
          <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
            {(pools ?? []).map((p) => (
              <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <Link href={`/pool/${p.id}`} className="text-accent-primary hover:underline">{p.question}</Link>
                <span className="text-text-secondary">{humanizeEnum(p.status)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
