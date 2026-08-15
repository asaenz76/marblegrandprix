import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Wordmark } from "@/components/Wordmark";

afterEach(() => cleanup());

// Phase 12 branding: the shared wordmark is the single source of the brand
// lockup. These guard that current surfaces read "Marble Grand Prix" and never
// the retired "brohda." brand.
describe("Wordmark", () => {
  it("renders the Marble Grand Prix brand and never brohda", () => {
    render(<Wordmark variant="full" />);
    expect(screen.getByText("Marble Grand Prix")).toBeInTheDocument();
    expect(screen.queryByText(/brohda/i)).not.toBeInTheDocument();
  });

  it("uses the MGP monogram in the mark variant", () => {
    render(<Wordmark variant="mark" />);
    expect(screen.getByText("MGP")).toBeInTheDocument();
  });

  it("carries both the monogram and full name in the responsive variant", () => {
    render(<Wordmark variant="responsive" />);
    // Both render in the DOM; CSS shows one per breakpoint.
    expect(screen.getByText("MGP")).toBeInTheDocument();
    expect(screen.getByText("Marble Grand Prix")).toBeInTheDocument();
  });

  it("links to the given href with an accessible brand label", () => {
    render(<Wordmark href="/feed" variant="full" />);
    const link = screen.getByRole("link", { name: "Marble Grand Prix" });
    expect(link).toHaveAttribute("href", "/feed");
  });
});
