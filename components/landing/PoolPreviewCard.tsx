"use client";

import { MessageCircle, Heart } from "lucide-react";
import type { SocialPoolCardViewModel } from "@/lib/pools/view-model";
import { formatCents, formatBps } from "@/lib/utils/money";
import { PoolLeagueHeader } from "@/components/pools/PoolLeagueHeader";
import { MatchIdentity } from "@/components/pools/MatchIdentity";
import { RacingPoolHeader } from "@/components/racing/RacingPoolHeader";
import { CompetitorIdentity } from "@/components/racing/CompetitorIdentity";
import { PoolOptionButton } from "@/components/pools/PoolOptionButton";
import { PoolDistributionBar } from "@/components/pools/PoolDistributionBar";
import { AvatarStack } from "@/components/pools/AvatarStack";

// A read-only preview of the real SocialPoolCard, built from the exact same
// view-model + presentational sub-components the logged-in Feed renders —
// so what a visitor sees pre-login is genuinely the product, not a
// recreation of it. No entry sheet, no like/comment actions, no realtime
// subscription: nothing here is clickable, matching a marketing page's
// "look, don't touch" expectation.
export function PoolPreviewCard({ viewModel }: { viewModel: SocialPoolCardViewModel }) {
  const isPreVote = viewModel.status === "OPEN_PRE_VOTE";
  const isPostVote = viewModel.status === "OPEN_POST_VOTE";
  const showDistribution = isPreVote || isPostVote;

  return (
    <article className="space-y-3.5 rounded-2xl border-2 border-border-subtle bg-surface-primary p-5 shadow-sticker">
      <PoolLeagueHeader
        competitionName={viewModel.fixture.competitionName}
        competitionCountry={viewModel.fixture.competitionCountry}
        competitionLogoUrl={viewModel.fixture.competitionLogoUrl}
        poolType={viewModel.poolType}
        visibility={viewModel.visibility}
        createdAt={viewModel.postedAt}
        locksAt={viewModel.locksAt}
        isLocked={false}
        isResolved={false}
        overrideLabel={
          viewModel.racing
            ? (viewModel.racing.competitionName ??
              (viewModel.racing.scope === "COMPETITION" ? "Competition pool" : "Race pool"))
            : undefined
        }
        overrideLogoUrl={viewModel.racing?.competitionImageUrl ?? null}
      />

      {viewModel.fixture.homeTeamName && <MatchIdentity fixture={viewModel.fixture} />}
      {/* Racing pools show their competition/race context where a football
          MatchIdentity would otherwise render — same as SocialPoolCard. */}
      {viewModel.racing && <RacingPoolHeader racing={viewModel.racing} />}
      {viewModel.title && !viewModel.racing && (
        <p className="text-sm font-medium text-text-secondary">{viewModel.title}</p>
      )}

      {/* Community sentiment leads — matches SocialPoolCard's hierarchy. */}
      {showDistribution && <PoolDistributionBar options={viewModel.options} />}

      {/* Social proof-of-life next, kept modest — context, not the main
          content. */}
      <div className="flex items-center justify-between gap-2">
        <AvatarStack
          participants={viewModel.socialProof.visibleParticipants}
          totalCount={viewModel.socialProof.participantCount}
        />
        <div className="flex items-center gap-3 text-text-secondary">
          <span className="flex items-center gap-1 text-sm font-medium">
            <Heart className="size-4" aria-hidden="true" />
            {viewModel.likeCount}
          </span>
          <span className="flex items-center gap-1 text-sm font-medium">
            <MessageCircle className="size-4" aria-hidden="true" />
            {viewModel.commentCount}
          </span>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-bold text-text-primary">{viewModel.question}</h3>
      </div>

      <div className="space-y-2">
        {viewModel.options.map((option) => {
          const competitor = viewModel.racing?.optionCompetitors[option.optionId];
          return (
            <PoolOptionButton
              key={option.optionId}
              label={option.label}
              logoUrl={option.teamLogoUrl}
              // Racing options render the full competitor identity
              // (colors/number/name/image), N-agnostically — same as the feed.
              leading={competitor ? <CompetitorIdentity competitor={competitor} /> : undefined}
              isWinner={viewModel.racing?.winnerOptionId === option.optionId}
              percentage={option.percentage}
              estimatedPayout={option.estimatedPayout}
              isCurrentUserChoice={false}
              disabled
              onSelect={() => {}}
            />
          );
        })}
      </div>

      <p className="text-xs text-text-muted">
        Entry {formatCents(viewModel.entryFee)} · Platform Fee{" "}
        {formatBps(viewModel.houseFeeBasisPoints)}
        {showDistribution && (
          <>
            {" · Requires "}
            {viewModel.minTotalEntries}+ entries to run
          </>
        )}
      </p>
    </article>
  );
}
