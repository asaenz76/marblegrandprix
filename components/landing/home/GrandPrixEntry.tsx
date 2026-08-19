import Link from "next/link";
import type { SocialPoolCardViewModel } from "@/lib/pools/view-model";
import type { HomeRound } from "@/lib/landing/fetch";
import { PoolPreviewCard } from "../PoolPreviewCard";

/**
 * Grand Prix Entry — the paid Sunday prediction pool, always named to the Grand
 * Prix it belongs to. Entry amount, fee and lock time come from the pool card
 * itself. Clearly the paid, official-championship counterpart to Practice.
 */
export function GrandPrixEntry({
  pool,
  grandPrix,
}: {
  pool: SocialPoolCardViewModel | null;
  grandPrix: HomeRound | null;
}) {
  return (
    <section id="enter" className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl font-extrabold">
          {grandPrix ? `${grandPrix.title} Grand Prix` : "Grand Prix Entry"}
        </h2>
        <span className="inline-flex items-center rounded-md border-2 border-border-subtle bg-accent-primary px-2.5 py-0.5 text-xs font-semibold text-white shadow-sticker-sm">
          Official championship
        </span>
      </div>
      <p className="mb-4 max-w-2xl text-sm text-text-secondary">
        The official Sunday championship race. Its finishing order awards the season points that decide the
        championship.
      </p>

      {pool ? (
        <div className="max-w-xl space-y-3">
          <PoolPreviewCard viewModel={pool} hideEconomics />
          <Link href="/register" className="inline-flex h-11 items-center rounded-lg border-2 border-border-subtle bg-primary px-5 font-semibold text-primary-foreground shadow-sticker-sm">
            Enter Grand Prix
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
