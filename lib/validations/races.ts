import { z } from "zod";

// A competitor supplied during race creation: either a reference to an existing
// persistent competitor, or a new inline competitor. Mirrors the Phase-2
// structural rules (>=1 identifier, 1..4 colors) so the frontend and database
// never diverge — the DB constraints remain authoritative.
export const raceCompetitorInputSchema = z
  .object({
    // Reuse path: pick an existing persistent competitor from the library.
    existingCompetitorId: z.string().uuid().optional(),

    // Inline-create path fields (all optional individually; >=1 required):
    name: z.string().trim().min(1).max(80).optional(),
    number: z.string().trim().min(1).max(20).optional(),
    colors: z.array(z.string().trim().min(1).max(40)).min(1).max(4).optional(),
    imageUrl: z.string().trim().url().max(2048).optional(),

    // "Save this competitor for future races" — persistent when true, else
    // race-only (scoped to the race being created). Ignored on the reuse path.
    persistent: z.boolean().default(false),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.existingCompetitorId) {
      // Reuse path: identity comes from the existing row; inline fields are not
      // used to mutate it here.
      return;
    }
    // Inline-create path: at least one meaningful identifier must be present.
    if (!c.name && !c.number && (!c.colors || c.colors.length === 0) && !c.imageUrl) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A competitor needs a name, number, colors, or image." });
    }
  });

export type RaceCompetitorInput = z.infer<typeof raceCompetitorInputSchema>;

// Minimum 2 competitors for a real race (Phase 4 §18). No domain-level maximum.
export const createRaceSchema = z
  .object({
    // Competition context: use an existing competition OR create a standalone
    // one by name (Super-Admin-only path, enforced in the action).
    competitionId: z.string().uuid().optional(),
    newCompetitionName: z.string().trim().min(1).max(120).optional(),

    title: z.string().trim().min(1).max(120),
    raceNumber: z.number().int().positive().max(100000).optional(),
    scheduledStartUtc: z.string().datetime({ offset: true }).optional(),
    locksAt: z.string().datetime({ offset: true }).optional(),
    videoUrl: z.string().trim().url().max(2048).optional(),

    competitors: z.array(raceCompetitorInputSchema).min(2, "A race needs at least 2 competitors."),
  })
  .strict()
  .superRefine((v, ctx) => {
    const hasExisting = !!v.competitionId;
    const hasNew = !!v.newCompetitionName;
    if (hasExisting === hasNew) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one of an existing competition or a new competition name.",
        path: ["competitionId"],
      });
    }
    // Lock time (if given) must be at or before the scheduled start.
    if (v.locksAt && v.scheduledStartUtc && new Date(v.locksAt) > new Date(v.scheduledStartUtc)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Lock time cannot be after the scheduled start.", path: ["locksAt"] });
    }
    // No duplicate existing competitor within one race.
    const existingIds = v.competitors.map((c) => c.existingCompetitorId).filter(Boolean) as string[];
    if (new Set(existingIds).size !== existingIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The same competitor cannot be added twice to a race.", path: ["competitors"] });
    }
  });

// Input type (pre-parse): `persistent` and other defaulted fields are optional
// for callers (the action/core parse and apply defaults).
export type CreateRaceInput = z.input<typeof createRaceSchema>;
