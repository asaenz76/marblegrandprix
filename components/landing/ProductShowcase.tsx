"use client";

import type { SocialPoolCardViewModel } from "@/lib/pools/view-model";
import type { LandingLeaderboardEntry } from "@/lib/landing/fetch";
import { Podium } from "@/components/leaderboard/Podium";
import { RankedList } from "@/components/leaderboard/RankedList";
import { PhoneFrame } from "./PhoneFrame";
import { PoolPreviewCard } from "./PoolPreviewCard";
import { LandingCompetitionGroup } from "./LandingCompetitionGroup";
import { groupPoolsByCompetition } from "@/lib/pools/feed-grouping";

const NIL_USER_ID = "00000000-0000-0000-0000-000000000000";

function ShowcasePanel({
  index,
  title,
  description,
  children,
}: {
  index: number;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="flex size-6 items-center justify-center rounded-full bg-[#ffc440]/20 text-[#ffc440]">
          {index}
        </span>
        {title}
      </div>
      <p className="text-sm text-inverted-surface-foreground/70">{description}</p>
      <PhoneFrame onDark>{children}</PhoneFrame>
    </div>
  );
}

export function ProductShowcase({
  feedPools,
  leaderboard,
}: {
  feedPools: SocialPoolCardViewModel[];
  leaderboard: LandingLeaderboardEntry[];
}) {
  const hasFeed = feedPools.length > 0;
  const hasLeaderboard = leaderboard.length > 0;

  if (!hasFeed && !hasLeaderboard) return null;

  let panelIndex = 0;

  return (
    <section className="border-y border-border-subtle bg-[#3b2114] py-16 text-inverted-surface-foreground">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-balance text-center font-display text-2xl font-extrabold sm:text-3xl">
          Built for <span className="text-[#ffc440]">competition</span>. Made for{" "}
          <span className="text-[#ffc440]">community</span>.
        </h2>

        <div className="mx-auto mt-12 grid max-w-3xl gap-10 sm:grid-cols-2">
          {hasFeed && (
            <ShowcasePanel
              index={++panelIndex}
              title="Your feed"
              description="See which races the community is calling, and jump in."
            >
              <div className="space-y-3">
                {groupPoolsByCompetition(feedPools).map((item) =>
                  item.kind === "competition" ? (
                    <LandingCompetitionGroup key={`comp-${item.competitionId}`} group={item} />
                  ) : (
                    <PoolPreviewCard key={item.vm.poolId} viewModel={item.vm} />
                  ),
                )}
              </div>
            </ShowcasePanel>
          )}

          {hasLeaderboard && (
            <ShowcasePanel
              index={++panelIndex}
              title="Leaderboard"
              description="See who's been calling races best across the community."
            >
              <div className="space-y-3">
                <Podium entries={leaderboard.slice(0, 3)} currentUserId={NIL_USER_ID} />
                <RankedList entries={leaderboard} currentUserId={NIL_USER_ID} />
              </div>
            </ShowcasePanel>
          )}
        </div>
      </div>
    </section>
  );
}
