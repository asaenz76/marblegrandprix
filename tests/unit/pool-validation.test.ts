import { describe, expect, it } from "vitest";
import {
  updatePoolSchema,
  enterPoolSchema,
  voidEntrySchema,
} from "@/lib/validations/pools";
import { winningMarginConfigSchema, teamSideOnlyConfigSchema } from "@/lib/pools/templates/goals";
import { teamSideConfigSchema } from "@/lib/pools/templates/match-result";

const validCreate = {
  fixtureId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  poolType: "WHO_WILL_ADVANCE" as const,
  entryFeeCents: 1000,
  houseFeeBps: 1000,
  visibility: "VISIBLE_TO_ALL_MEMBERS" as const,
  participationVisibility: "SHOW_AFTER_ENTRY" as const,
  locksAt: new Date().toISOString(),
};

// The per-template config schemas remain in use by the retained football
// settlement/grading compatibility chain (gradeTemplatePool). Their validation
// behavior is exercised here even though pools are no longer created through a
// football template builder.
describe("per-template config schemas", () => {
  it("winningMarginConfigSchema accepts a valid team+margin payload", () => {
    expect(winningMarginConfigSchema.safeParse({ team: "HOME", minimumMargin: 2 }).success).toBe(
      true,
    );
  });

  it("winningMarginConfigSchema rejects an invalid team side", () => {
    expect(
      winningMarginConfigSchema.safeParse({ team: "MIDDLE", minimumMargin: 2 }).success,
    ).toBe(false);
  });

  it("winningMarginConfigSchema rejects a margin outside its bounds", () => {
    expect(winningMarginConfigSchema.safeParse({ team: "HOME", minimumMargin: 0 }).success).toBe(
      false,
    );
    expect(winningMarginConfigSchema.safeParse({ team: "HOME", minimumMargin: 11 }).success).toBe(
      false,
    );
  });

  it("teamSideOnlyConfigSchema (clean sheet / win to nil) accepts just a team", () => {
    expect(teamSideOnlyConfigSchema.safeParse({ team: "AWAY" }).success).toBe(true);
    expect(teamSideOnlyConfigSchema.safeParse({ team: "AWAY", extra: 1 }).success).toBe(false);
  });

  it("teamSideConfigSchema (team to avoid defeat) matches the same shape", () => {
    expect(teamSideConfigSchema.safeParse({ team: "HOME" }).success).toBe(true);
  });
});

describe("updatePoolSchema", () => {
  const validUpdate = {
    poolId: validCreate.fixtureId,
    entryFeeCents: validCreate.entryFeeCents,
    houseFeeBps: validCreate.houseFeeBps,
    visibility: validCreate.visibility,
    participationVisibility: validCreate.participationVisibility,
    locksAt: validCreate.locksAt,
  };

  it("accepts a fully valid payload", () => {
    expect(updatePoolSchema.safeParse(validUpdate).success).toBe(true);
  });

  it("rejects a missing poolId", () => {
    const { poolId, ...rest } = validUpdate;
    void poolId;
    expect(updatePoolSchema.safeParse(rest).success).toBe(false);
  });
});

describe("enterPoolSchema", () => {
  const valid = {
    poolId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    optionId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    amountCents: 1000,
    idempotencyKey: "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
  };

  it("accepts a valid entry", () => {
    expect(enterPoolSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a zero amount", () => {
    expect(enterPoolSchema.safeParse({ ...valid, amountCents: 0 }).success).toBe(false);
  });

  it("rejects a non-uuid idempotency key", () => {
    expect(enterPoolSchema.safeParse({ ...valid, idempotencyKey: "not-a-uuid" }).success).toBe(
      false,
    );
  });
});

describe("voidEntrySchema", () => {
  const valid = {
    entryId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    reason: "Player requested cancellation",
    idempotencyKey: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  };

  it("accepts a valid payload", () => {
    expect(voidEntrySchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an empty reason", () => {
    expect(voidEntrySchema.safeParse({ ...valid, reason: "   " }).success).toBe(false);
  });
});
