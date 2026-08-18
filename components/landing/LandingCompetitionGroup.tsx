"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { FeedGroup } from "@/lib/pools/feed-grouping";
import { humanizeEnum } from "@/lib/utils/humanize";
import { cn } from "@/lib/utils";
import { PoolPreviewCard } from "./PoolPreviewCard";

/**
 * Read-only landing counterpart to CompetitionGroupCard: a competition shows as
 * one card (the overall-winner pool up top) with its race pools behind a "Show N
 * races" toggle. The marketing preview isn't interactive, so an opened race is a
 * plain read-only preview card rather than the feed's inline-enter accordion.
 */
export function LandingCompetitionGroup({ group }: { group: FeedGroup }) {
  const [open, setOpen] = useState(false);
  const n = group.racePools.length;

  return (
    <div className="space-y-2">
      {group.winnerPool ? (
        <PoolPreviewCard viewModel={group.winnerPool} />
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-border-subtle bg-surface-primary p-5">
          {group.competitionImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={group.competitionImageUrl} alt="" className="size-8 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="size-8 shrink-0 rounded-full bg-surface-elevated" aria-hidden="true" />
          )}
          <div>
            <p className="text-sm font-semibold text-text-primary">{group.competitionName ?? "Competition"}</p>
            {group.competitionFormat && (
              <p className="text-xs text-text-muted">{humanizeEnum(group.competitionFormat)}</p>
            )}
          </div>
        </div>
      )}

      {n > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex w-full items-center justify-between rounded-xl border border-border-subtle bg-surface-primary px-4 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-secondary"
          >
            <span>
              {open ? "Hide" : "Show"} {n} race{n === 1 ? "" : "s"}
            </span>
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <div className="mt-2 space-y-2 border-l-2 border-border-subtle pl-2 sm:pl-3">
              {group.racePools.map((rp) => (
                <PoolPreviewCard key={rp.poolId} viewModel={rp} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
