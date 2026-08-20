import { requireOrganizerOrAbove } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/guards";
import { RaceCreateForm } from "./race-create-form";
import { BoldFormSurface } from "@/components/ui/bold-form-surface";
import type { CompetitorIdentityData } from "@/components/racing/CompetitorIdentity";

// Single Race creation (Phase 4). First-class racing-native flow — no fixtures,
// no provider, no home/away. Eligibility is the coarse organizer gate here; the
// per-competition assignment check is enforced server-side in createRaceAction.
export default async function NewRacePage({ searchParams }: { searchParams: Promise<{ competition?: string }> }) {
  const { competition: preselectedCompetitionId } = await searchParams;
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

  // Teams (constructors) available to add as an entrant — expands to its members.
  const { data: teamRows } = await client
    .from("racing_teams")
    .select("id, name, color, image_url")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(200);
  const teamIds = (teamRows ?? []).map((t) => t.id as string);
  const membersByTeam: Record<string, CompetitorIdentityData[]> = {};
  if (teamIds.length) {
    const { data: mem } = await client
      .from("racing_team_members")
      .select("team_id, sort_order, competitors ( name, number, colors, image_url )")
      .in("team_id", teamIds)
      .order("sort_order", { ascending: true });
    for (const m of (mem ?? []) as unknown as Array<{ team_id: string; competitors: { name: string | null; number: string | null; colors: string[] | null; image_url: string | null } | null }>) {
      (membersByTeam[m.team_id] ??= []).push({
        name: m.competitors?.name ?? null,
        number: m.competitors?.number ?? null,
        colors: m.competitors?.colors ?? null,
        imageUrl: m.competitors?.image_url ?? null,
      });
    }
  }
  const teams = (teamRows ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    color: (t.color as string | null) ?? null,
    imageUrl: (t.image_url as string | null) ?? null,
    members: membersByTeam[t.id as string] ?? [],
  }));

  // Preselect + lock the competition when arriving from a competition page
  // ("Add race"), so the operator isn't asked to re-pick the same competition.
  const preselected = preselectedCompetitionId && competitions.some((c) => c.id === preselectedCompetitionId)
    ? competitions.find((c) => c.id === preselectedCompetitionId)!
    : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Create a race</h1>
        <p className="text-sm text-text-secondary">
          {preselected ? <>Adding a race to <span className="font-medium text-text-primary">{preselected.name}</span>.</> : "Add a field of competitors and schedule the race."}
        </p>
      </div>
      <BoldFormSurface>
        <RaceCreateForm
          competitions={competitions}
          canCreateCompetition={superAdmin}
          library={lib ?? []}
          teams={teams}
          racesByCompetition={racesByCompetition}
          lockedCompetitionId={preselected?.id ?? null}
        />
      </BoldFormSurface>
    </div>
  );
}
