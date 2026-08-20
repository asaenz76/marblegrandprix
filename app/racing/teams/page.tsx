import { requireOrganizerOrAbove } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { TeamLibrary } from "./team-library";
import type { LibraryTeam } from "@/components/racing/TeamForm";
import type { LibraryCompetitor } from "@/components/racing/CompetitorForm";
import type { CompetitorIdentityData } from "@/components/racing/CompetitorIdentity";

// Racing teams library (F1-style constructors). A team groups 1+ library
// marbles ("drivers"); the constructors' championship is derived from these
// memberships. Shared global resource — any organizer/super-admin manages it.
export default async function TeamsPage() {
  await requireOrganizerOrAbove();
  const admin = createAdminClient();

  const [{ data: teamRows }, { data: libraryRows }] = await Promise.all([
    admin.from("racing_teams").select("id, name, image_url, color").eq("is_active", true).order("created_at", { ascending: false }).limit(500),
    admin
      .from("competitors")
      .select("id, name, number, colors, image_url")
      .eq("is_persistent", true)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const teams = teamRows ?? [];
  const teamIds = teams.map((t) => t.id as string);

  type MemberRow = {
    team_id: string;
    competitor_id: string;
    sort_order: number;
    competitors: { id: string; name: string | null; number: string | null; colors: string[] | null; image_url: string | null } | null;
  };
  let memberRows: MemberRow[] = [];
  if (teamIds.length) {
    const { data } = await admin
      .from("racing_team_members")
      .select("team_id, competitor_id, sort_order, competitors ( id, name, number, colors, image_url )")
      .in("team_id", teamIds)
      .order("sort_order", { ascending: true });
    memberRows = (data ?? []) as unknown as MemberRow[];
  }

  const teamNameById = new Map(teams.map((t) => [t.id as string, t.name as string]));
  const membersByTeam: Record<string, CompetitorIdentityData[]> = {};
  const memberIdsByTeam: Record<string, string[]> = {};
  const membershipByCompetitor: Record<string, { teamId: string; teamName: string }> = {};
  for (const m of memberRows) {
    (memberIdsByTeam[m.team_id] ??= []).push(m.competitor_id);
    const c = m.competitors;
    (membersByTeam[m.team_id] ??= []).push({
      name: c?.name ?? null,
      number: c?.number ?? null,
      colors: c?.colors ?? null,
      imageUrl: c?.image_url ?? null,
    });
    membershipByCompetitor[m.competitor_id] = { teamId: m.team_id, teamName: teamNameById.get(m.team_id) ?? "a team" };
  }

  const libraryTeams: LibraryTeam[] = teams.map((t) => ({
    id: t.id as string,
    name: t.name as string,
    imageUrl: (t.image_url as string | null) ?? null,
    color: (t.color as string | null) ?? null,
    memberIds: memberIdsByTeam[t.id as string] ?? [],
  }));

  const library: LibraryCompetitor[] = (libraryRows ?? []).map((c) => ({
    id: c.id as string,
    name: (c.name as string | null) ?? null,
    number: (c.number as string | null) ?? null,
    colors: (c.colors as string[] | null) ?? null,
    imageUrl: (c.image_url as string | null) ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Teams</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-secondary">
          F1-style constructors: each team groups marbles from your competitors library. A marble races for at most one
          team. Team points are the sum of its members&apos; points — the constructors&apos; championship.
        </p>
      </div>
      <TeamLibrary
        teams={libraryTeams}
        membersByTeam={membersByTeam}
        library={library}
        membershipByCompetitor={membershipByCompetitor}
      />
    </div>
  );
}
