import Link from "next/link";
import type { SocialPoolCardViewModel } from "@/lib/pools/view-model";
import type { HomeRound } from "@/lib/landing/fetch";
import { PoolPreviewCard } from "../PoolPreviewCard";

/**
 * The featured entry pool. It adapts to what the pool actually is: a single
 * Sunday race (RACE scope) is titled after that Grand Prix, while a season-long
 * championship-winner pool (COMPETITION scope) is titled after the championship
 * and clearly framed as the whole-season prediction — never conflating the
 * week's race with the season. Header/label mirror the pool's own identity so
 * the section and the card can't disagree.
 */
export function GrandPrixEntry({
  pool,
  grandPrix,
}: {
  pool: SocialPoolCardViewModel | null;
  grandPrix: HomeRound | null;
}) {
  const isSeason = pool?.racing?.scope === "COMPETITION";
  const heading = isSeason
    ? (pool?.racing?.competitionName ?? "Season championship")
    : grandPrix
      ? `${grandPrix.title} Grand Prix`
      : "Grand Prix entry";
  const blurb = isSeason
    ? "Call the marble that wins the whole season — points from every Grand Prix decide the champion. This pool runs the length of the championship, not a single race."
    : "The official Sunday race. Its finishing order awards the season points that count toward the championship.";
  const label = isSeason ? "Season-long" : "Official round";
  const cta = isSeason ? "Enter championship pool" : "Enter Grand Prix";

  return (
    <section id="enter" className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl font-extrabold">{heading}</h2>
        <span className="inline-flex items-center rounded-full bg-accent-primary px-2.5 py-1 text-xs font-semibold text-white">
          {label}
        </span>
      </div>
      <p className="mb-4 max-w-2xl text-sm text-text-secondary">{blurb}</p>

      {pool ? (
        <div className="max-w-xl space-y-3">
          <PoolPreviewCard viewModel={pool} hideEconomics />
          <Link href="/register" className="inline-flex h-11 items-center rounded-lg border-2 border-border-subtle bg-primary px-5 font-semibold text-primary-foreground shadow-sticker-sm">
            {cta}
          </Link>
        </div>
      ) : (
        <div className="max-w-xl rounded-2xl border-2 border-dashed border-border-subtle p-8 text-center">
          <p className="font-semibold text-text-primary">Grand Prix entry opens closer to race day</p>
          <p className="mt-1 text-sm text-text-muted">Entries for the next official round will appear here.</p>
        </div>
      )}
    </section>
  );
}
