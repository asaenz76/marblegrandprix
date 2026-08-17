/**
 * Unit tests for Phase 9 — the pure presentation transforms for racing pools:
 * buildPoolCardViewModel's racing branch (racing field, race-aware rule label,
 * N-agnostic options, selection reflection) and buildNoticeCopy's isRacing
 * neutral copy. No DB, no money.
 */
import { describe, expect, it } from "vitest";
import { buildPoolCardViewModel, deriveRacingQuestion, type BuildViewModelInput } from "@/lib/pools/view-model";
import { buildNoticeCopy } from "@/lib/pools/notices";
import type { RacingPoolContext } from "@/lib/racing/pool-presentation";

const neutralFixture: BuildViewModelInput["fixture"] = {
  competition_name: null, competition_country: null, competition_logo_url: null, round: null,
  scheduled_start_utc: "2035-01-01T00:00:00Z", home_team_name: "", home_team_logo_url: null,
  away_team_name: "", away_team_logo_url: null, internal_status: "NOT_STARTED",
  elapsed_minutes: null, home_score: null, away_score: null,
};

function racingContext(overrides: Partial<RacingPoolContext> = {}): RacingPoolContext {
  return {
    scope: "RACE", competitionId: "c1", competitionName: "Marble Cup", competitionFormat: "SINGLE_RACE",
    competitionStatus: "ACTIVE", championCompetitorId: null, champion: null, raceId: "r1", raceTitle: "Race 1",
    raceStatus: "SCHEDULED", scheduledStartUtc: "2035-01-01T00:00:00Z", optionCompetitors: {}, winnerOptionId: null,
    result: { status: "PENDING", winner: null, winnerCompetitorId: null, order: [] }, ...overrides,
  };
}

function makeInput(overrides: Partial<BuildViewModelInput> = {}): BuildViewModelInput {
  return {
    pool: {
      id: "p1", question: "Who wins this race?", title: null, pool_type: "TEMPLATE_GRADED", entry_fee: 1000,
      house_fee_bps: 0, min_total_entries: 2, locks_at: "2035-01-01T00:00:00Z", status: "OPEN",
      created_at: "2026-01-01T00:00:00Z", void_reason: null, review_reason: null, visibility: "VISIBLE_TO_ALL_MEMBERS",
      like_count: 0, comment_count: 0,
    },
    fixture: neutralFixture,
    options: [
      { id: "o1", label: "#1 Rojo", logo_url: null, entry_count: 0, total_entry_amount: 0, is_winning_option: false },
      { id: "o2", label: "#2 Azul", logo_url: null, entry_count: 0, total_entry_amount: 0, is_winning_option: false },
      { id: "o3", label: "#3 Verde", logo_url: null, entry_count: 0, total_entry_amount: 0, is_winning_option: false },
      { id: "o4", label: "#4 Oro", logo_url: null, entry_count: 0, total_entry_amount: 0, is_winning_option: false },
    ],
    currentUserEntry: null,
    totals: { total_entries: 0, gross_pool: 0 },
    participants: [], participantCount: 0, finalPayout: null, isLikedByCurrentUser: false,
    racing: racingContext(),
    ...overrides,
  };
}

describe("Phase 9 — buildPoolCardViewModel racing branch", () => {
  it("populates the racing context and an N-agnostic option list (no Draw fabricated)", () => {
    const vm = buildPoolCardViewModel(makeInput());
    expect(vm.racing).not.toBeNull();
    expect(vm.options).toHaveLength(4);
    expect(vm.options.map((o) => o.label)).not.toContain("Draw");
  });

  it("uses a race-aware rule label instead of the football 'fixture result'", () => {
    expect(buildPoolCardViewModel(makeInput()).ruleLabel).toBe("Auto-graded from the race result");
    const compVm = buildPoolCardViewModel(makeInput({ racing: racingContext({ scope: "COMPETITION" }) }));
    expect(compVm.ruleLabel).toBe("Auto-graded from the competition result");
  });

  it("a football pool (no racing context) keeps its original rule label and null racing", () => {
    const vm = buildPoolCardViewModel(makeInput({ racing: null, pool: { ...makeInput().pool, pool_type: "CUSTOM" } }));
    expect(vm.racing ?? null).toBeNull();
    expect(vm.ruleLabel).not.toContain("race result");
  });

  it("reflects the player's selected competitor option", () => {
    const vm = buildPoolCardViewModel(makeInput({ currentUserEntry: { option_id: "o3", amount: 1000, status: "ACTIVE" } }));
    expect(vm.currentUser.selectedOptionId).toBe("o3");
    expect(vm.options.find((o) => o.optionId === "o3")!.isCurrentUserChoice).toBe(true);
    expect(vm.options.filter((o) => o.isCurrentUserChoice)).toHaveLength(1);
  });

  it("settled WON / LOST / REFUNDED entries produce a truthful notice", () => {
    const won = buildPoolCardViewModel(makeInput({
      pool: { ...makeInput().pool, status: "SETTLED" },
      options: makeInput().options.map((o) => (o.id === "o1" ? { ...o, is_winning_option: true } : o)),
      currentUserEntry: { option_id: "o1", amount: 1000, status: "WON" }, finalPayout: 3000,
    }));
    expect(won.notice?.type).toBe("SETTLED_WON");
    expect(won.currentUser.finalPayout).toBe(3000);

    const lost = buildPoolCardViewModel(makeInput({
      pool: { ...makeInput().pool, status: "SETTLED" },
      options: makeInput().options.map((o) => (o.id === "o1" ? { ...o, is_winning_option: true } : o)),
      currentUserEntry: { option_id: "o2", amount: 1000, status: "LOST" },
    }));
    expect(lost.notice?.type).toBe("SETTLED_LOST");

    const refunded = buildPoolCardViewModel(makeInput({
      pool: { ...makeInput().pool, status: "VOIDED", void_reason: "NO_WINNING_ENTRIES" },
      currentUserEntry: { option_id: "o2", amount: 1000, status: "REFUNDED" },
    }));
    expect(refunded.currentUser.refundedAmount).toBe(1000);
  });
});

describe("scope/format-aware pool question", () => {
  it("derives the question from scope + competition format", () => {
    expect(deriveRacingQuestion("RACE", null)).toBe("Who wins this race?");
    expect(deriveRacingQuestion("RACE", "CHAMPIONSHIP")).toBe("Who wins this race?");
    expect(deriveRacingQuestion("COMPETITION", "CHAMPIONSHIP")).toBe("Who wins the championship?");
    expect(deriveRacingQuestion("COMPETITION", "LEAGUE")).toBe("Who wins the league?");
    expect(deriveRacingQuestion("COMPETITION", "BRACKET")).toBe("Who wins the bracket?");
    expect(deriveRacingQuestion("COMPETITION", "ELIMINATION")).toBe("Who's last standing?");
    expect(deriveRacingQuestion("COMPETITION", "SINGLE_RACE")).toBe("Who wins this race?");
    expect(deriveRacingQuestion("COMPETITION", "MIXED")).toBe("Who wins the competition?");
    expect(deriveRacingQuestion("COMPETITION", null)).toBe("Who wins the competition?");
  });

  it("the racing card shows the derived question, overriding the stored template string", () => {
    // A championship-format competition pool whose stored pool.question is the
    // generic template text still renders the format-specific question.
    const compChampionship = buildPoolCardViewModel(
      makeInput({
        pool: { ...makeInput().pool, question: "Who wins this competition?" },
        racing: racingContext({ scope: "COMPETITION", competitionFormat: "CHAMPIONSHIP" }),
      }),
    );
    expect(compChampionship.question).toBe("Who wins the championship?");

    const elimination = buildPoolCardViewModel(
      makeInput({ racing: racingContext({ scope: "COMPETITION", competitionFormat: "ELIMINATION" }) }),
    );
    expect(elimination.question).toBe("Who's last standing?");

    const race = buildPoolCardViewModel(makeInput({ racing: racingContext({ scope: "RACE" }) }));
    expect(race.question).toBe("Who wins this race?");
  });

  it("a non-racing pool keeps its stored question verbatim", () => {
    const custom = buildPoolCardViewModel(
      makeInput({ racing: null, pool: { ...makeInput().pool, pool_type: "CUSTOM", question: "Who wins?" } }),
    );
    expect(custom.question).toBe("Who wins?");
  });
});

describe("Phase 9 — buildNoticeCopy isRacing", () => {
  it("racing pools get neutral 'the result' copy, not football 'kickoff'", () => {
    const racing = buildNoticeCopy({ poolStatus: "LOCKED", fixtureInternalStatus: "NOT_STARTED", voidReason: null, entryStatus: null, entryAmount: 0, finalPayout: null, isRacing: true });
    expect(racing?.message).toContain("Waiting for the result");
    expect(racing?.message).not.toContain("kickoff");

    const football = buildNoticeCopy({ poolStatus: "LOCKED", fixtureInternalStatus: "NOT_STARTED", voidReason: null, entryStatus: null, entryAmount: 0, finalPayout: null });
    expect(football?.message).toContain("kickoff");
  });
});
