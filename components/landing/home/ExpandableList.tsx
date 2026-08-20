"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A height-bounded panel so long lists (the player leaderboard, a pool's marble
 * options) scroll inside their own container instead of stretching the whole
 * page. Collapsed by default with an internal scrollbar; once the content
 * exceeds `threshold` items a toggle reveals the full list inline. If JS never
 * runs, it degrades to the bounded scroll box — still fully readable.
 *
 * `framed` wraps the scroll region in a subtle tray (for standalone lists like
 * the leaderboard); pass `framed={false}` when the list already sits inside a
 * card (like the pool option list).
 */
export function ExpandableList({
  children,
  count,
  threshold,
  collapsedMaxHeight = "22rem",
  itemNoun = "items",
  framed = true,
  className,
}: {
  children: ReactNode;
  count: number;
  threshold: number;
  collapsedMaxHeight?: string;
  itemNoun?: string;
  framed?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = count > threshold;

  return (
    <div className={className}>
      <div
        className={cn(
          "overflow-y-auto overscroll-contain",
          framed && "rounded-2xl border-2 border-border-subtle bg-surface-secondary p-2",
        )}
        style={{ maxHeight: expanded ? undefined : collapsedMaxHeight }}
      >
        {children}
      </div>
      {canExpand && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border-2 border-border-subtle bg-surface-primary px-3 py-1.5 text-sm font-semibold text-text-primary shadow-sticker-sm"
        >
          <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
          {expanded ? "Show less" : `Show all ${count} ${itemNoun}`}
        </button>
      )}
    </div>
  );
}
