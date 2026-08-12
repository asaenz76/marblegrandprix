import { requireOrganizerOrAbove } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/guards";
import { RaceCreateForm } from "./race-create-form";

// Single Race creation (Phase 4). First-class racing-native flow — no fixtures,
// no provider, no home/away. Eligibility is the coarse organizer gate here; the
// per-competition assignment check is enforced server-side in createRaceAction.
export default async function NewRacePage() {
  const profile = await requireOrganizerOrAbove();
  const client = createAdminClient();
  const superAdmin = isSuperAdmin(profile);

  let competitions: { id: string; name: string; format: string }[] = [];
  if (superAdmin) {
    const { data } = await client.from("racing_competitions").select("id, name, format").order("created_at", { ascending: false });
    competitions = data ?? [];
  } else {
    const { data: assignments } = await client.from("competition_organizers").select("competition_id").eq("organizer_id", profile.id);
    const ids = (assignments ?? []).map((a) => a.competition_id);
    if (ids.length) {
      const { data } = await client.from("racing_competitions").select("id, name, format").in("id", ids).order("created_at", { ascending: false });
      competitions = data ?? [];
    }
  }

  // Source races (per competition) that a placeholder slot can advance from —
  // used to author BRACKET/ELIMINATION rounds referencing an earlier round.
  const racesByCompetition: Record<string, { id: string; title: string | null }[]> = {};
  const compIds = competitions.map((c) => c.id);
  if (compIds.length) {
    const { data: allRaces } = await client.from("races").select("id, title, competition_id").in("competition_id", compIds).order("created_at", { ascending: true });
    for (const r of allRaces ?? []) {
      (racesByCompetition[r.competition_id] ??= []).push({ id: r.id, title: r.title });
    }
  }

  const { data: lib } = await client
    .from("competitors")
    .select("id, name, number, colors")
    .eq("is_persistent", true)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Create a race</h1>
        <p className="text-sm text-text-secondary">Add a field of competitors and schedule the race.</p>
      </div>
      <RaceCreateForm competitions={competitions} canCreateCompetition={superAdmin} library={lib ?? []} racesByCompetition={racesByCompetition} />
    </div>
  );
}
