/**
 * Racing prediction templates (Phase 5). V1 active templates: RACE_WINNER and
 * COMPETITION_WINNER only — no Podium/Head-to-Head/Exact-Order/etc.
 *
 * This reuses the existing template *concept* (id + version + exact-version
 * lookup) but NOT the football PoolTemplate.gradingRule(FixtureDataBundle) ->
 * YES/NO contract: "who wins" is a pick-one-of-N-by-competitor decision, graded
 * by lib/racing/grade-race-pool.ts against the authoritative race/competition
 * outcome. Kept in a separate racing registry so no football template body is
 * involved and no 2/3-outcome assumption can leak in.
 */

export type RacingTemplateId = "RACE_WINNER" | "COMPETITION_WINNER";
export type RacingTemplateScope = "RACE" | "COMPETITION";

export interface RacingTemplate {
  id: RacingTemplateId;
  version: number;
  name: string;
  /** Player-facing question; no odds, no football, no home/away/draw. */
  question: string;
  scope: RacingTemplateScope;
  activeForCreation: boolean;
}

export const RACING_TEMPLATE_REGISTRY: RacingTemplate[] = [
  { id: "RACE_WINNER", version: 1, name: "Race Winner", question: "Who wins this race?", scope: "RACE", activeForCreation: true },
  {
    id: "COMPETITION_WINNER",
    version: 1,
    name: "Competition Winner",
    question: "Who wins this competition?",
    scope: "COMPETITION",
    activeForCreation: true,
  },
];

// Exact-version resolution — an already-created pool always grades against the
// version it was created with, never a newer one (mirrors getTemplate()).
export function getRacingTemplate(id: string, version: number): RacingTemplate | null {
  return RACING_TEMPLATE_REGISTRY.find((t) => t.id === id && t.version === version) ?? null;
}

// Latest creatable version for a template id (mirrors getLatestTemplate()).
export function getLatestRacingTemplate(id: string): RacingTemplate | null {
  const candidates = RACING_TEMPLATE_REGISTRY.filter((t) => t.id === id && t.activeForCreation);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.version > a.version ? b : a));
}

export function isRacingTemplateId(id: string | null | undefined): id is RacingTemplateId {
  return id === "RACE_WINNER" || id === "COMPETITION_WINNER";
}
