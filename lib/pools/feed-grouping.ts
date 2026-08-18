import type { SocialPoolCardViewModel } from "./view-model";

/**
 * Feed grouping (Phase 18): fold a competition's pools into one card so a
 * championship with a "win it all" pool and many races shows as a single
 * competition card with the overall-winner pool up top and its race pools
 * nested behind a toggle — instead of spilling a dozen separate cards.
 *
 * A competition is grouped only when nesting earns its place: a Competition
 * Winner pool with at least one race pool, or two or more race pools. A lone
 * race pool (e.g. a Single Race competition) stays a normal flat card. Pure and
 * order-preserving — the group appears where its first pool would have.
 */
export type FeedGroup = {
  kind: "competition";
  competitionId: string;
  competitionName: string | null;
  competitionImageUrl: string | null;
  competitionFormat: string | null;
  winnerPool: SocialPoolCardViewModel | null;
  racePools: SocialPoolCardViewModel[];
};

export type FeedItem = { kind: "pool"; vm: SocialPoolCardViewModel } | FeedGroup;

export function groupPoolsByCompetition(viewModels: SocialPoolCardViewModel[]): FeedItem[] {
  const groups = new Map<string, { winner: SocialPoolCardViewModel | null; races: SocialPoolCardViewModel[] }>();
  for (const vm of viewModels) {
    const cid = vm.racing?.competitionId;
    if (!cid) continue;
    const g = groups.get(cid) ?? { winner: null, races: [] };
    if (vm.racing!.scope === "COMPETITION") g.winner = vm;
    else g.races.push(vm);
    groups.set(cid, g);
  }

  const groupedIds = new Set<string>();
  for (const [cid, g] of groups) {
    if ((g.winner && g.races.length >= 1) || g.races.length >= 2) groupedIds.add(cid);
  }

  const items: FeedItem[] = [];
  const emitted = new Set<string>();
  for (const vm of viewModels) {
    const cid = vm.racing?.competitionId;
    if (cid && groupedIds.has(cid)) {
      if (emitted.has(cid)) continue; // already folded into its group
      emitted.add(cid);
      const g = groups.get(cid)!;
      const src = (g.winner ?? g.races[0])!;
      items.push({
        kind: "competition",
        competitionId: cid,
        competitionName: src.racing!.competitionName,
        competitionImageUrl: src.racing!.competitionImageUrl,
        competitionFormat: src.racing!.competitionFormat,
        winnerPool: g.winner,
        racePools: g.races,
      });
    } else {
      items.push({ kind: "pool", vm });
    }
  }
  return items;
}
