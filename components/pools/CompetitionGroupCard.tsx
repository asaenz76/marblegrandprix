"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { PaymentMethodRow } from "@/lib/payment-methods/fetch";
import type { FeedGroup } from "@/lib/pools/feed-grouping";
import { humanizeEnum } from "@/lib/utils/humanize";
import { cn } from "@/lib/utils";
import { SocialPoolCard } from "./SocialPoolCard";

/**
 * Feed grouping (Phase 18): one card for a whole competition. The overall
 * Competition Winner pool renders full (enterable) up top; the competition's
 * race pools are tucked behind a "Show N races" toggle and, when opened, each
 * expands inline (collapsible SocialPoolCard) so a player can pick without
 * leaving the feed. Keeps a many-race championship to a single tidy card.
 */
export function CompetitionGroupCard({
  group,
  balanceCents,
  paymentMethods,
  viewer,
}: {
  group: FeedGroup;
  balanceCents: number;
  paymentMethods: PaymentMethodRow[];
  viewer: { id: string; isModerator: boolean };
}) {
  const [open, setOpen] = useState(false);
  const shared = { balanceCents, paymentMethods, viewer };
  const n = group.racePools.length;

  return (
    <div className="space-y-2">
      {group.winnerPool ? (
        <SocialPoolCard viewModel={group.winnerPool} {...shared} />
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border-2 border-border-subtle bg-surface-primary p-5 shadow-sticker">
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
            className="flex w-full items-center justify-between rounded-xl border-2 border-border-subtle bg-surface-primary px-4 py-2.5 shadow-sticker-sm text-sm font-medium text-text-secondary hover:bg-surface-secondary"
          >
            <span>
              {open ? "Hide" : "Show"} {n} race{n === 1 ? "" : "s"}
            </span>
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <div className="mt-2 space-y-2 border-l-2 border-border-subtle pl-2 sm:pl-3">
              {group.racePools.map((rp) => (
                <SocialPoolCard key={rp.poolId} viewModel={rp} collapsible {...shared} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
