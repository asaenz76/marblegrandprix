/**
 * Racing Phase 16: competition/race icon upload plumbing. Covers the pure,
 * DB-free pieces — the image validation constants + MIME sniffing, and that the
 * create schemas accept an optional imageUrl while rejecting a non-URL. The
 * upload route, storage, and persistence are exercised by integration/browser.
 */
import { describe, expect, it } from "vitest";
import {
  RACING_IMAGE_MAX_BYTES,
  RACING_IMAGE_OUTPUT_SIZE,
  detectImageMime,
} from "@/lib/validations/racing-image";
import { createCompetitionSchema } from "@/lib/racing/create-competition";
import { createRaceSchema } from "@/lib/validations/races";

const URL = "https://example.supabase.co/storage/v1/object/public/racing-images/x.webp";

describe("racing-image validation", () => {
  it("exposes a 5MB cap and a square output size", () => {
    expect(RACING_IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(RACING_IMAGE_OUTPUT_SIZE).toBeGreaterThan(0);
  });

  it("sniffs real image magic bytes and rejects non-images", () => {
    expect(detectImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
    expect(detectImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectImageMime(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });
});

describe("create schemas accept an optional competition/race icon URL", () => {
  it("competition: optional, accepts a URL, rejects a non-URL", () => {
    expect(createCompetitionSchema.safeParse({ name: "Cup", format: "CHAMPIONSHIP" }).success).toBe(true);
    expect(createCompetitionSchema.safeParse({ name: "Cup", format: "CHAMPIONSHIP", imageUrl: URL }).success).toBe(true);
    expect(createCompetitionSchema.safeParse({ name: "Cup", format: "CHAMPIONSHIP", imageUrl: "not a url" }).success).toBe(false);
  });

  it("race: optional, accepts a URL, rejects a non-URL", () => {
    const base = {
      newCompetitionName: "Cup",
      title: "Opening Race",
      competitors: [{ name: "Red" }, { name: "Blue" }],
    };
    expect(createRaceSchema.safeParse(base).success).toBe(true);
    expect(createRaceSchema.safeParse({ ...base, imageUrl: URL }).success).toBe(true);
    expect(createRaceSchema.safeParse({ ...base, imageUrl: "nope" }).success).toBe(false);
  });
});
