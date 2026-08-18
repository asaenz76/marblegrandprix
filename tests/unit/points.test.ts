import { describe, expect, it } from "vitest";
import { pointsConfigSchema, configToRows, rowsToConfig, POINTS_PRESETS } from "@/lib/racing/points";

describe("championship points config", () => {
  it("round-trips rows <-> config", () => {
    const rows = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
    const cfg = rowsToConfig(rows);
    expect(cfg).toEqual({ "1": 25, "2": 18, "3": 15, "4": 12, "5": 10, "6": 8, "7": 6, "8": 4, "9": 2, "10": 1 });
    expect(configToRows(cfg)).toEqual(rows);
  });

  it("configToRows fills gaps as 0 and falls back to the default preset when empty", () => {
    expect(configToRows({ "1": 10, "3": 4 })).toEqual([10, 0, 4]);
    expect(configToRows({})).toEqual(POINTS_PRESETS[1].rows);
  });

  it("rowsToConfig floors to non-negative integers", () => {
    expect(rowsToConfig([10.7, -3, NaN])).toEqual({ "1": 10, "2": 0, "3": 0 });
  });

  it("schema accepts a valid table and rejects bad shapes", () => {
    expect(pointsConfigSchema.safeParse({ "1": 25, "2": 18 }).success).toBe(true);
    expect(pointsConfigSchema.safeParse({}).success).toBe(false); // needs >=1 position
    expect(pointsConfigSchema.safeParse({ "0": 5 }).success).toBe(false); // position must be >=1
    expect(pointsConfigSchema.safeParse({ "1": -1 }).success).toBe(false); // points must be >=0
    expect(pointsConfigSchema.safeParse({ "1": 1.5 }).success).toBe(false); // integer only
  });

  it("both presets are valid configs", () => {
    for (const preset of POINTS_PRESETS) {
      expect(pointsConfigSchema.safeParse(rowsToConfig(preset.rows)).success).toBe(true);
    }
  });
});
