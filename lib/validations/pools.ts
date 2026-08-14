import { z } from "zod";

// Platform-wide guardrail: every pool needs at least this many entries by
// lock time or the lock cron auto-cancels it and refunds everyone in full
// (lib/pools/lock.ts's isBelowMinimum check against pools.min_total_entries).
// Fixed, not admin-chosen — pools created before this existed keep whatever
// lower value they were seeded with (updatePoolSchema never touches it).
// Lowered from 10 to 2 for beta testing, where pools rarely have more than a
// handful of participants.
export const MINIMUM_POOL_ENTRIES = 2;

// Enforced against a pool's linked fixture in updatePoolAction (the one place
// a human still edits locks_at on a fixture-backed legacy pool) — not as a DB
// constraint, deliberately: several integration tests attach a pool to a
// fixture whose scheduled_start_utc is already in the past (to exercise
// settlement/grading against an "already happened" match) with a locks_at
// that's still in the future, which would violate a blanket DB-level version
// of this rule despite that being an intentional test setup, not a real
// admin-facing creation flow.
export const MINIMUM_LOCK_LEAD_MINUTES = 5;

const visibilityEnum = z.enum(["VISIBLE_TO_ALL_MEMBERS", "HIDDEN"]);
const participationVisibilityEnum = z.enum([
  "SHOW_BEFORE_ENTRY",
  "SHOW_AFTER_ENTRY",
  "SHOW_AFTER_LOCK",
  "NEVER_SHOW",
]);

// Excludes minTotalEntries — an existing pool's minimum is left untouched on
// update (preserves pools grandfathered in under the old per-pool default
// rather than silently raising it on an unrelated edit).
export const updatePoolSchema = z
  .object({
    poolId: z.string().uuid(),
    entryFeeCents: z.number().int().positive(),
    houseFeeBps: z.number().int().min(0).max(10000),
    visibility: visibilityEnum,
    participationVisibility: participationVisibilityEnum,
    locksAt: z.string().datetime(),
  })
  .strict();

export type UpdatePoolInput = z.infer<typeof updatePoolSchema>;

export const enterPoolSchema = z
  .object({
    poolId: z.string().uuid(),
    optionId: z.string().uuid(),
    amountCents: z.number().int().positive(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

export type EnterPoolInput = z.infer<typeof enterPoolSchema>;

export const voidEntrySchema = z
  .object({
    entryId: z.string().uuid(),
    reason: z.string().trim().min(1),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

export type VoidEntryInput = z.infer<typeof voidEntrySchema>;
