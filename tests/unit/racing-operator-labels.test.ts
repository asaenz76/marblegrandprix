/**
 * Unit tests for Phase 10 operator plain-language labels — no raw enums leak to
 * the operator. Pure string mapping; no DB, no money.
 */
import { describe, expect, it } from "vitest";
import { summarizeSettlementOutcomes, RACING_REVIEW_REASON_TEXT } from "@/lib/racing/operator-labels";

describe("Phase 10 — summarizeSettlementOutcomes", () => {
  it("reports nothing to settle plainly", () => {
    expect(summarizeSettlementOutcomes(undefined)).toBe("No pools needed settling.");
    expect(summarizeSettlementOutcomes({})).toBe("No pools needed settling.");
  });

  it("maps raw outcome enums to plain language and pluralizes", () => {
    expect(summarizeSettlementOutcomes({ a: "settled" })).toBe("1 pool paid out");
    expect(summarizeSettlementOutcomes({ a: "settled", b: "settled" })).toBe("2 pools paid out");
    const mixed = summarizeSettlementOutcomes({ a: "settled", b: "settled", c: "refunded", d: "manualReview" });
    expect(mixed).toContain("2 pools paid out");
    expect(mixed).toContain("1 pool refunded");
    expect(mixed).toContain("1 pool sent for manual review");
    // no raw camelCase enum tokens leak
    expect(mixed).not.toContain("manualReview");
    expect(mixed).not.toContain("settled");
  });
});

describe("Phase 10 — racing review reason text", () => {
  it("has plain-language text for racing review reasons (no raw enum)", () => {
    expect(RACING_REVIEW_REASON_TEXT.RACE_RESULT_UNRESOLVABLE).toMatch(/couldn't be matched/i);
    expect(RACING_REVIEW_REASON_TEXT.WINNER_NOT_IN_POOL_OPTIONS).toMatch(/isn't one of this pool/i);
    for (const text of Object.values(RACING_REVIEW_REASON_TEXT)) {
      expect(text).not.toMatch(/_[A-Z]/); // no SCREAMING_SNAKE tokens
    }
  });
});
