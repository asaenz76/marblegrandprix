import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompetitionAccess } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { CompetitorIdentity } from "@/components/racing/CompetitorIdentity";
import { humanizeEnum } from "@/lib/utils/humanize";
import { ResultForm } from "./result-form";

// Race detail + result entry (Phase 6). Access is re-checked server-side:
// requireCompetitionAccess enforces the Phase 3 assignment boundary (super_admin
// or an organizer assigned to THIS race's competition); players/legacy-admin denied.
export default async function RaceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data: race } = await admin.from("races").select("id, title, status, competition_id, racing_competitions(name)").eq("id", id).maybeSingle();
  if (!race) notFound();

  // Enforce per-competition authorization (redirects if not permitted).
  await requireCompetitionAccess(race.competition_id);

  const { data: rc } = await admin
    .from("race_competitors")
    .select("competitor_id, competitors ( id, name, number, colors )")
    .eq("race_id", id)
    .not("competitor_id", "is", null)
    .order("sort_order");
  const competitors = (rc ?? []).map((r) => r.competitors as unknown as { id: string; name: string | null; number: string | null; colors: string[] | null }).filter(Boolean);

  const { data: confirmed } = await admin.from("race_results").select("id, winner_competitor_id").eq("race_id", id).eq("status", "CONFIRMED").maybeSingle();
  const comp = race.racing_competitions as unknown as { name: string } | null;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{race.title ?? "Race"}</h1>
        <p className="text-sm text-text-secondary">
          <Link href={`/racing/competitions/${race.competition_id}`} className="text-accent-primary hover:underline">{comp?.name}</Link>
          {" · "}{humanizeEnum(race.status)}
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Competitors ({competitors.length})</h2>
        <ul className="space-y-1">
          {competitors.map((c) => (
            <li key={c.id} className="text-sm"><CompetitorIdentity competitor={c} /></li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Result</h2>
        <ResultForm raceId={id} competitors={competitors} alreadyConfirmed={!!confirmed} />
      </section>
    </div>
  );
}
