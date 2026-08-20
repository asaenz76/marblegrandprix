import { z } from "zod";

// Validation for the racing teams library (F1-style constructors). A team has a
// name, an optional logo/accent, and 1+ member competitors ("drivers"). Member
// uniqueness across teams (a driver is on one team) is enforced by the DB
// (racing_team_members.competitor_id UNIQUE); here we only guard the shape and
// dedupe within a single submission.

const memberIdsSchema = z
  .array(z.string().uuid())
  .min(1, "A team needs at least one marble.")
  .max(20, "A team can have at most 20 marbles.")
  .superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A marble can only be added once." });
    }
  });

const teamFields = {
  name: z.string().trim().min(1, "A team needs a name.").max(80),
  imageUrl: z.string().trim().url().max(2048).optional(),
  color: z.string().trim().min(1).max(40).optional(),
  memberCompetitorIds: memberIdsSchema,
};

export const createTeamSchema = z.object(teamFields).strict();

export const updateTeamSchema = z.object({ id: z.string().uuid(), ...teamFields }).strict();

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
