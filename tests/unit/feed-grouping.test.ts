import { describe, expect, it } from "vitest";
import { groupPoolsByCompetition, type FeedGroup } from "@/lib/pools/feed-grouping";
import type { SocialPoolCardViewModel } from "@/lib/pools/view-model";

// Minimal view models — grouping only reads poolId + racing.
const mkVm = (poolId: string, comp?: string, scope: "RACE" | "COMPETITION" = "RACE"): SocialPoolCardViewModel =>
  ({
    poolId,
    racing: comp
      ? { scope, competitionId: comp, competitionName: "Cup", competitionImageUrl: null, competitionFormat: "CHAMPIONSHIP" }
      : null,
  }) as unknown as SocialPoolCardViewModel;

describe("groupPoolsByCompetition", () => {
  it("groups a competition-winner pool with its race pools into one card", () => {
    const items = groupPoolsByCompetition([
      mkVm("win", "c1", "COMPETITION"),
      mkVm("r1", "c1"),
      mkVm("r2", "c1"),
    ]);
    expect(items).toHaveLength(1);
    const g = items[0] as FeedGroup;
    expect(g.kind).toBe("competition");
    expect(g.winnerPool?.poolId).toBe("win");
    expect(g.racePools.map((p) => p.poolId)).toEqual(["r1", "r2"]);
  });

  it("groups two or more race pools even with no winner pool", () => {
    const items = groupPoolsByCompetition([mkVm("r1", "c1"), mkVm("r2", "c1")]);
    expect(items).toHaveLength(1);
    const g = items[0] as FeedGroup;
    expect(g.winnerPool).toBeNull();
    expect(g.racePools).toHaveLength(2);
  });

  it("leaves a lone race pool flat (single-race competition)", () => {
    const items = groupPoolsByCompetition([mkVm("r1", "c1")]);
    expect(items).toEqual([{ kind: "pool", vm: expect.objectContaining({ poolId: "r1" }) }]);
  });

  it("leaves a winner pool with no races flat", () => {
    const items = groupPoolsByCompetition([mkVm("win", "c1", "COMPETITION")]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("pool");
  });

  it("keeps non-racing pools flat and preserves order (group sits at its first pool)", () => {
    const items = groupPoolsByCompetition([
      mkVm("football"),
      mkVm("win", "c1", "COMPETITION"),
      mkVm("r1", "c1"),
      mkVm("standalone", "c2"),
    ]);
    expect(items.map((i) => (i.kind === "pool" ? i.vm.poolId : `group:${(i as FeedGroup).competitionId}`))).toEqual([
      "football",
      "group:c1",
      "standalone",
    ]);
  });
});
