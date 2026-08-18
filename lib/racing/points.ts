import { z } from "zod";

/**
 * Championship points config (Phase 19): a position -> points map, e.g.
 * { "1": 25, "2": 18, ... }. Pure helpers shared by the editor UI and the
 * server action, and unit-tested here rather than through the DB.
 */
export const pointsConfigSchema = z
  .record(z.string().regex(/^[1-9]\d*$/), z.number().int().min(0).max(10000))
  .refine((o) => {
    const n = Object.keys(o).length;
    return n >= 1 && n <= 50;
  }, "The points table must have between 1 and 50 positions.");

export const POINTS_PRESETS: { label: string; rows: number[] }[] = [
  { label: "F1 top 10", rows: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] },
  { label: "Default", rows: [10, 6, 4, 3, 2, 1] },
];

/** points_config map -> a contiguous rows array (index i = points for position i+1). */
export function configToRows(cfg: Record<string, number>): number[] {
  const positions = Object.keys(cfg)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1);
  const max = positions.length ? Math.max(...positions) : 0;
  const rows: number[] = [];
  for (let p = 1; p <= max; p++) rows.push(cfg[String(p)] ?? 0);
  return rows.length ? rows : [...POINTS_PRESETS[1].rows];
}

/** rows array -> a points_config map with contiguous 1-based keys, floored to >= 0. */
export function rowsToConfig(rows: number[]): Record<string, number> {
  const cfg: Record<string, number> = {};
  rows.forEach((p, i) => {
    cfg[String(i + 1)] = Math.max(0, Math.floor(Number.isFinite(p) ? p : 0));
  });
  return cfg;
}
