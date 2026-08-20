import { z } from "zod";

// Validation for the saved competitors library (persistent marbles reused
// across races). Mirrors the DB competitors constraints — >=1 identifier
// (competitors_has_identifier) and 1..4 colors (competitors_colors_1_to_4) —
// so the client and database never diverge; the DB constraints stay
// authoritative.

const colorsSchema = z.array(z.string().trim().min(1).max(40)).min(1).max(4);

const identityFields = {
  name: z.string().trim().min(1).max(80).optional(),
  number: z.string().trim().min(1).max(20).optional(),
  colors: colorsSchema.optional(),
  imageUrl: z.string().trim().url().max(2048).optional(),
};

function requireIdentifier(
  c: { name?: string; number?: string; colors?: string[]; imageUrl?: string },
  ctx: z.RefinementCtx,
) {
  if (!c.name && !c.number && (!c.colors || c.colors.length === 0) && !c.imageUrl) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A competitor needs a name, number, colors, or image." });
  }
}

export const createCompetitorSchema = z.object(identityFields).strict().superRefine(requireIdentifier);

export const updateCompetitorSchema = z
  .object({ id: z.string().uuid(), ...identityFields })
  .strict()
  .superRefine(requireIdentifier);

export type CreateCompetitorInput = z.infer<typeof createCompetitorSchema>;
export type UpdateCompetitorInput = z.infer<typeof updateCompetitorSchema>;
