import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RacingPoolHeader } from "@/components/racing/RacingPoolHeader";
import type { RacingPoolContext } from "@/lib/racing/pool-presentation";

afterEach(() => cleanup());

const base: RacingPoolContext = {
  scope: "RACE",
  competitionId: "comp-1",
  competitionName: "Spring Grand Prix",
  competitionFormat: "CHAMPIONSHIP",
  competitionStatus: "ACTIVE",
  competitionImageUrl: null,
  championCompetitorId: null,
  champion: null,
  raceId: "race-1",
  raceTitle: "Round 4 — Cobalt Straight",
  raceStatus: "SCHEDULED",
  raceImageUrl: null,
  scheduledStartUtc: null,
  optionCompetitors: {},
  winnerOptionId: null,
  result: null,
};

// Phase 12 unified the Race Winner and Competition Winner cards so they read as
// one product family: the competition name is the card identity (in the header
// above), the scope-specific line lives here, and the format is humanized.
describe("RacingPoolHeader", () => {
  it("shows a linked race title, humanized status, and format for a RACE pool", () => {
    render(<RacingPoolHeader racing={base} />);
    const raceLink = screen.getByRole("link", { name: "Round 4 — Cobalt Straight" });
    expect(raceLink).toHaveAttribute("href", "/races/race-1");
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    expect(screen.getByText("Championship")).toBeInTheDocument();
  });

  it("shows a linked 'Overall winner' (never a bare 'Competition winner') for a COMPETITION pool", () => {
    render(
      <RacingPoolHeader
        racing={{ ...base, scope: "COMPETITION", raceId: null, raceTitle: null, raceStatus: null }}
      />,
    );
    const link = screen.getByRole("link", { name: "Overall winner" });
    expect(link).toHaveAttribute("href", "/competitions/comp-1");
    expect(screen.queryByText("Competition winner")).not.toBeInTheDocument();
    expect(screen.getByText("Championship")).toBeInTheDocument();
  });

  it("never leaks a raw format enum", () => {
    render(<RacingPoolHeader racing={{ ...base, competitionFormat: "SINGLE_RACE" }} />);
    expect(screen.queryByText("SINGLE_RACE")).not.toBeInTheDocument();
    expect(screen.getByText("Single race")).toBeInTheDocument();
  });
});
