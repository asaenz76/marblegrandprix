import { z } from "zod";

// A competitor supplied during race creation: either a reference to an existing
// persistent competitor, or a new inline competitor. Mirrors the Phase-2
// structural rules (>=1 identifier, 1..4 colors) so the frontend and database
// never diverge — the DB constraints remain authoritative.
// A progression placeholder slot (Phase 8): the occupant is not known at
// authoring time; it advances from a source race by rule. WINNER = the confirmed
// winner (bracket); POSITION = the competitor who finished in `sourcePosition`
// (elimination). The engine fills it deterministically when the source confirms.
export const progressionSourceSchema = z
  .object({
    sourceRaceId: z.string().uuid(),
    sourceRule: z.enum(["WINNER", "POSITION"]),
    sourcePosition: z.number().int().positive().max(1000).optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.sourceRule === "POSITION" && !s.sourcePosition) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A POSITION slot needs the qualifying finishing position.", path: ["sourcePosition"] });
    }
  });

export const raceCompetitorInputSchema = z
  .object({
    // Reuse path: pick an existing persistent competitor from the library.
    existingCompetitorId: z.string().uuid().optional(),

    // Team path: pick a team from the library; it expands to one entrant per
    // member marble (each tagged with the team for grouping). The winner is
    // still a single marble.
    teamId: z.string().uuid().optional(),

    // Inline-create path fields (all optional individually; >=1 required):
    name: z.string().trim().min(1).max(80).optional(),
    number: z.string().trim().min(1).max(20).optional(),
    colors: z.array(z.string().trim().min(1).max(40)).min(1).max(4).optional(),
    imageUrl: z.string().trim().url().max(2048).optional(),

    // "Save this competitor for future races" — persistent when true, else
    // race-only (scoped to the race being created). Ignored on the reuse path.
    persistent: z.boolean().default(false),

    // Phase 8: instead of a known competitor, this slot advances from a race.
    advancesFrom: progressionSourceSchema.optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    // Placeholder slot: identity is deferred to the progression engine.
    if (c.advancesFrom) {
      if (c.existingCompetitorId || c.teamId || c.name || c.number || c.colors || c.imageUrl) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A progression slot cannot also name a competitor." });
      }
      return;
    }
    // Team slot: identity is the team's members; no other fields apply.
    if (c.teamId) {
      if (c.existingCompetitorId || c.name || c.number || c.colors || c.imageUrl) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A team entrant cannot also name a competitor." });
      }
      return;
    }
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
    // Format for a newly-created competition (ignored when joining an existing
    // one). SINGLE_RACE is the Phase 4 default; CHAMPIONSHIP/LEAGUE opt into the
    // Phase 7 standings + finalization path; BRACKET/ELIMINATION opt into the
    // Phase 8 single-elimination progression path. MIXED remains deferred.
    newCompetitionFormat: z.enum(["SINGLE_RACE", "CHAMPIONSHIP", "LEAGUE", "BRACKET", "ELIMINATION"]).default("SINGLE_RACE"),

    // Optional stage (round) this race belongs to (Phase 8 authoring).
    stageId: z.string().uuid().optional(),

    title: z.string().trim().min(1).max(120),
    raceNumber: z.number().int().positive().max(100000).optional(),
    scheduledStartUtc: z.string().datetime({ offset: true }).optional(),
    locksAt: z.string().datetime({ offset: true }).optional(),
    videoUrl: z.string().trim().url().max(2048).optional(),
    // Optional rounded icon (Phase 16). A public URL from the
    // /api/racing-image upload route; never a browser-supplied storage write.
    imageUrl: z.string().trim().url().max(2048).optional(),

    // At least one entrant row; a single team row expands to its members, so the
    // real ">= 2 marbles" minimum is enforced after expansion in create-race.ts.
    competitors: z.array(raceCompetitorInputSchema).min(1, "A race needs at least one entrant."),
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
    // No duplicate team within one race (cross-team member overlap is deduped in
    // create-race.ts, since teams aren't expanded here).
    const teamIds = v.competitors.map((c) => c.teamId).filter(Boolean) as string[];
    if (new Set(teamIds).size !== teamIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The same team cannot be added twice to a race.", path: ["competitors"] });
    }
  });

// Input type (pre-parse): `persistent` and other defaulted fields are optional
// for callers (the action/core parse and apply defaults).
export type CreateRaceInput = z.input<typeof createRaceSchema>;
