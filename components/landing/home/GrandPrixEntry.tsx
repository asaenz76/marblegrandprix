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
  const roundNo = grandPrix?.roundNumber != null ? String(grandPrix.roundNumber).padStart(2, "0") : "01";
  const eyebrow = isSeason ? "Season championship" : `Round ${roundNo} · Race Day`;
  const heading = isSeason
    ? (pool?.racing?.competitionName ?? "Season championship")
    : grandPrix
      ? `${grandPrix.title} Grand Prix`
      : "Grand Prix";
  const punch = isSeason ? "The whole season on one pick." : "This one counts.";
  const blurb = isSeason
    ? "Call the marble that wins the whole season — points from every Grand Prix decide the champion. This runs the length of the championship, not a single race."
    : "Pick the marble you think will take the chequered flag. Sunday's finishing order awards official championship points.";
  const cta = isSeason ? "Enter Championship Pool" : "Enter Grand Prix";

  return (
    <section id="enter" className="mx-auto max-w-6xl px-4 sm:px-6">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent-primary-label">{eyebrow}</p>
      <h2 className="font-display text-3xl font-extrabold uppercase tracking-wide sm:text-4xl">{heading}</h2>
      <p className="mt-2 text-lg font-semibold text-text-primary">{punch}</p>
      <p className="mb-4 mt-1 max-w-2xl text-sm text-text-secondary">{blurb}</p>

      {pool ? (
        <div className="max-w-xl space-y-3">
          <PoolPreviewCard viewModel={pool} hideEconomics />
          <Link href="/register" className="inline-flex h-11 items-center rounded-lg border-2 border-border-subtle bg-primary px-5 font-semibold uppercase tracking-wide text-primary-foreground shadow-sticker-sm">
            {cta}
          </Link>
        </div>
      ) : (
        <div className="max-w-xl rounded-2xl border-2 border-dashed border-border-subtle p-8 text-center">
          <p className="font-semibold uppercase tracking-wide text-text-primary">Grand Prix entry opens closer to race day</p>
          <p className="mt-1 text-sm text-text-muted">Entries for the next official round will appear here.</p>
        </div>
      )}
    </section>
  );
}
