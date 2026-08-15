import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CompetitorIdentity } from "@/components/racing/CompetitorIdentity";

afterEach(() => cleanup());

// Competitor color is product data. These guard the Phase 12 rules: color is
// never the only identifier when other identity exists, swatches always carry a
// theme-contrasting ring so they can't vanish, and stored color order is kept.
describe("CompetitorIdentity", () => {
  it("renders number and name together", () => {
    render(<CompetitorIdentity competitor={{ number: "7", name: "Azure Comet" }} />);
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Azure Comet")).toBeInTheDocument();
  });

  it("falls back to a text color list when a competitor has only colors", () => {
    render(<CompetitorIdentity competitor={{ colors: ["Red", "White", "Blue"] }} />);
    // A non-color identifier is always present, so color is never the sole cue.
    expect(screen.getByText("Red / White / Blue")).toBeInTheDocument();
  });

  it("puts a contrast ring on every color swatch and preserves color order", () => {
    const { container } = render(
      <CompetitorIdentity competitor={{ name: "Night Hornet", colors: ["#111111", "#f5c518"] }} />,
    );
    const swatches = container.querySelectorAll('span[title]');
    expect(swatches).toHaveLength(2);
    // Order preserved: first stored color first.
    expect(swatches[0]).toHaveAttribute("title", "#111111");
    expect(swatches[1]).toHaveAttribute("title", "#f5c518");
    // Ring applied via the theme-aware token, so a black/white swatch can't vanish.
    swatches.forEach((s) => {
      expect((s as HTMLElement).style.boxShadow).toContain("var(--competitor-ring)");
    });
  });
});
