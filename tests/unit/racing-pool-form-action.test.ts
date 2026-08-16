import { describe, expect, it } from "vitest";
import { createRacingPoolFromFormAction } from "@/lib/actions/racing-pools";

// The Phase 13 form action validates the operator's raw inputs and returns
// plain-language errors BEFORE it delegates to the authenticated creation
// action — so these invalid-input branches short-circuit and are testable
// without a session. No raw Zod/PostgREST text should ever be surfaced.
function fd(obj: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.set(k, v);
  return f;
}
const OK = {
  scope: "RACE",
  raceId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  entryFee: "5",
  platformFee: "10",
  locksAt: "2035-06-01T18:00:00.000Z",
  visibility: "VISIBLE_TO_ALL_MEMBERS",
};
const INITIAL = { error: null };

describe("createRacingPoolFromFormAction — plain-language validation", () => {
  it("rejects a non-numeric entry fee", async () => {
    const r = await createRacingPoolFromFormAction(INITIAL, fd({ ...OK, entryFee: "abc" }));
    expect(r.error).toMatch(/entry fee/i);
    expect(r.poolId).toBeUndefined();
  });

  it("rejects a zero entry fee", async () => {
    const r = await createRacingPoolFromFormAction(INITIAL, fd({ ...OK, entryFee: "0" }));
    expect(r.error).toMatch(/entry fee/i);
  });

  it("rejects a platform fee above 100%", async () => {
    const r = await createRacingPoolFromFormAction(INITIAL, fd({ ...OK, platformFee: "150" }));
    expect(r.error).toMatch(/platform fee/i);
  });

  it("rejects an empty/invalid lock time", async () => {
    expect((await createRacingPoolFromFormAction(INITIAL, fd({ ...OK, locksAt: "" }))).error).toMatch(/lock time/i);
    expect((await createRacingPoolFromFormAction(INITIAL, fd({ ...OK, locksAt: "not-a-date" }))).error).toMatch(/lock time/i);
  });

  it("rejects an invalid visibility value", async () => {
    const r = await createRacingPoolFromFormAction(INITIAL, fd({ ...OK, visibility: "BOGUS" }));
    expect(r.error).toMatch(/who can see/i);
  });

  it("rejects a missing scope", async () => {
    const r = await createRacingPoolFromFormAction(INITIAL, fd({ ...OK, scope: "" }));
    expect(r.error).toMatch(/something went wrong/i);
  });
});
