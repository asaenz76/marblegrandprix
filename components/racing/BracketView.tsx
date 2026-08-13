import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { CompetitorIdentity, type CompetitorIdentityData } from "@/components/racing/CompetitorIdentity";

/**
 * Read-only bracket / elimination structure view (Phase 8, §14). Shows enough to
 * understand the tournament: stages (rounds) → races → each slot's occupant
 * (a filled competitor, or its advancement source "Winner of …" / "Pn of …") →
 * the race's result status. No drag-and-drop, no tournament designer.
 */
export async function BracketView({ competitionId, raceBasePath = "/racing/races" }: { competitionId: string; raceBasePath?: string }) {
  const admin = createAdminClient();

  const [{ data: stages }, { data: races }] = await Promise.all([
    admin.from("competition_stages").select("id, name, stage_type, sequence_order, status").eq("competition_id", competitionId).order("sequence_order"),
    admin.from("races").select("id, title, status, race_number, stage_id").eq("competition_id", competitionId).order("race_number", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true }),
  ]);
  const raceList = races ?? [];
  const raceIds = raceList.map((r) => r.id);
  const titleById = new Map(raceList.map((r) => [r.id, r.title ?? "Untitled race"]));

  const slotsByRace = new Map<string, Array<{ competitor_id: string | null; is_placeholder: boolean; source_race_id: string | null; source_rule: string | null; source_position: number | null; sort_order: number }>>();
  const confirmedWinner = new Map<string, string>();
  const identities = new Map<string, CompetitorIdentityData>();

  if (raceIds.length) {
    const [{ data: slots }, { data: results }] = await Promise.all([
      admin.from("race_competitors").select("race_id, competitor_id, is_placeholder, source_race_id, source_rule, source_position, sort_order").in("race_id", raceIds).order("sort_order"),
      admin.from("race_results").select("race_id, winner_competitor_id").in("race_id", raceIds).eq("status", "CONFIRMED"),
    ]);
    for (const s of slots ?? []) {
      const list = slotsByRace.get(s.race_id) ?? [];
      list.push(s);
      slotsByRace.set(s.race_id, list);
    }
    for (const r of results ?? []) confirmedWinner.set(r.race_id, r.winner_competitor_id);

    const competitorIds = [...new Set([...(slots ?? []).map((s) => s.competitor_id), ...confirmedWinner.values()].filter(Boolean) as string[])];
    if (competitorIds.length) {
      const { data: comps } = await admin.from("competitors").select("id, name, number, colors, image_url").in("id", competitorIds);
      for (const c of comps ?? []) identities.set(c.id, { name: c.name, number: c.number, colors: c.colors, imageUrl: c.image_url });
    }
  }

  const slotLabel = (s: { competitor_id: string | null; is_placeholder: boolean; source_race_id: string | null; source_rule: string | null; source_position: number | null }) => {
    if (!s.is_placeholder && s.competitor_id) return <CompetitorIdentity size="sm" competitor={identities.get(s.competitor_id) ?? {}} />;
    const src = s.source_race_id ? titleById.get(s.source_race_id) ?? "a race" : "a race";
    const rule = s.source_rule === "POSITION" ? `P${s.source_position ?? "?"}` : "Winner";
    return <span className="text-text-secondary italic">{rule} of {src}</span>;
  };

  const renderRace = (r: (typeof raceList)[number]) => {
    const slots = (slotsByRace.get(r.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
    const winnerId = confirmedWinner.get(r.id);
    return (
      <div key={r.id} className="rounded-md border border-border-subtle p-3">
        <div className="flex items-center justify-between">
          <Link href={`${raceBasePath}/${r.id}`} className="text-sm font-medium text-accent-primary hover:underline">{r.title ?? "Untitled race"}</Link>
          <span className="text-xs text-text-secondary">{winnerId ? "Result confirmed" : "Awaiting result"}</span>
        </div>
        <ul className="mt-2 space-y-1">
          {slots.map((s, i) => {
            const isWinner = !!winnerId && s.competitor_id === winnerId;
            return (
              <li key={i} className="flex items-center gap-2 text-sm">
                <span className="w-4 text-text-secondary tabular-nums">{i + 1}</span>
                {slotLabel(s)}
                {isWinner && <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs text-success">Winner</span>}
              </li>
            );
          })}
          {slots.length === 0 && <li className="text-sm text-text-secondary">No competitors yet.</li>}
        </ul>
      </div>
    );
  };

  const stageList = stages ?? [];
  const unstaged = raceList.filter((r) => !r.stage_id);

  return (
    <div className="space-y-4">
      {stageList.map((stage) => {
        const stageRaces = raceList.filter((r) => r.stage_id === stage.id);
        return (
          <div key={stage.id} className="space-y-2">
            <h3 className="text-sm font-semibold">{stage.name} <span className="font-normal text-text-secondary">· {stage.status.toLowerCase()}</span></h3>
            <div className="space-y-2">{stageRaces.map(renderRace)}</div>
            {stageRaces.length === 0 && <p className="text-sm text-text-secondary">No races in this round yet.</p>}
          </div>
        );
      })}
      {unstaged.length > 0 && (
        <div className="space-y-2">
          {stageList.length > 0 && <h3 className="text-sm font-semibold">Other races</h3>}
          <div className="space-y-2">{unstaged.map(renderRace)}</div>
        </div>
      )}
      {raceList.length === 0 && <p className="text-sm text-text-secondary">No races yet. Author the bracket by creating races with progression slots.</p>}
    </div>
  );
}
