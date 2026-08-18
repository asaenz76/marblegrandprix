"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Competitor colors as removable chips (max 4), added via the browser's native
 * color input. Values are hex strings; older named colors (e.g. "Red") still
 * render fine since the swatch uses them as a CSS background directly. Controlled
 * — the parent owns the colors array.
 */
export function ColorChips({
  value,
  onChange,
  max = 4,
}: {
  value: string[];
  onChange: (colors: string[]) => void;
  max?: number;
}) {
  const [draft, setDraft] = useState("#3e63dd");

  const add = () => {
    if (value.length >= max) return;
    onChange([...value, draft]);
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {value.length === 0 && <span className="text-xs text-text-muted">No colors yet</span>}
        {value.map((c, i) => (
          <span
            key={`${c}-${i}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-secondary py-0.5 pr-1.5 pl-1 text-xs"
          >
            <span
              className="size-4 rounded-full"
              style={{ backgroundColor: c, boxShadow: "0 0 0 1px var(--competitor-ring, rgba(0,0,0,0.15))" }}
            />
            <span className="tabular-nums text-text-secondary">{c}</span>
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove ${c}`}
              className="flex size-4 items-center justify-center rounded-full text-text-muted hover:bg-surface-elevated hover:text-text-primary"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {value.length < max && (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Pick a color"
            className="h-8 w-10 cursor-pointer rounded border border-border-subtle bg-transparent p-0.5"
          />
          <Button type="button" variant="outline" size="sm" onClick={add}>
            Add color
          </Button>
        </div>
      )}
    </div>
  );
}
