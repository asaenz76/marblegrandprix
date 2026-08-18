"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCompetitionPointsAction } from "@/lib/actions/competitions";
import { configToRows, rowsToConfig, POINTS_PRESETS } from "@/lib/racing/points";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/**
 * Phase 19: championship points table editor. A flexible position -> points
 * list (add/remove positions, presets), saved to the competition's points_config.
 * Standings recompute live from it.
 */
export function PointsEditor({
  competitionId,
  pointsConfig,
}: {
  competitionId: string;
  pointsConfig: Record<string, number>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<number[]>(configToRows(pointsConfig));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = () => {
    setSaved(false);
    setError(null);
  };
  const setRow = (i: number, val: number) => {
    dirty();
    setRows((rs) => rs.map((r, idx) => (idx === i ? val : r)));
  };
  const addRow = () => {
    dirty();
    setRows((rs) => (rs.length < 50 ? [...rs, 0] : rs));
  };
  const removeRow = () => {
    dirty();
    setRows((rs) => (rs.length > 1 ? rs.slice(0, -1) : rs));
  };
  const applyPreset = (r: number[]) => {
    dirty();
    setRows([...r]);
  };

  function save() {
    setError(null);
    setSaved(false);
    const cfg = rowsToConfig(rows);
    startTransition(async () => {
      const res = await updateCompetitionPointsAction({ competitionId, pointsConfig: cfg });
      if (res.error) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {POINTS_PRESETS.map((p) => (
          <Button key={p.label} type="button" variant="outline" size="sm" onClick={() => applyPreset(p.rows)}>
            {p.label}
          </Button>
        ))}
      </div>

      <div className="space-y-1.5">
        {rows.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-10 text-sm text-text-secondary tabular-nums">{ordinal(i + 1)}</span>
            <Input
              type="number"
              min={0}
              value={String(p)}
              onChange={(e) => setRow(i, Number(e.target.value))}
              className="w-24"
            />
            <span className="text-xs text-text-muted">pts</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={rows.length >= 50}>
          Add position
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={removeRow} disabled={rows.length <= 1}>
          Remove last
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && !error && <p className="text-sm text-success">Points saved — standings will use them.</p>}

      <Button type="button" size="sm" onClick={save} disabled={pending}>
        {pending ? "Saving…" : "Save points"}
      </Button>
    </div>
  );
}
