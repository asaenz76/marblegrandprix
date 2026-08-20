import Link from "next/link";
import type { SocialPoolCardViewModel } from "@/lib/pools/view-model";
import { PoolPreviewCard } from "../PoolPreviewCard";

/**
 * Today's Practice Race — a free weekday Single-Race pool. Explicitly free, and
 * explicit that it does not affect the official championship.
 */
export function PracticeRaceCard({ pool }: { pool: SocialPoolCardViewModel | null }) {
  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6">
      <h2 className="mb-1 font-display text-2xl font-extrabold uppercase tracking-wide">Today&apos;s Practice</h2>
      <p className="mb-3 max-w-2xl text-sm font-semibold text-text-primary">Study the grid. Make your pick. Build your streak.</p>
      <p className="mb-4 max-w-2xl text-sm text-text-secondary">
        Practice races run Monday through Thursday. Results do not count toward the official championship
        standings.
      </p>

      {pool ? (
        <div className="max-w-xl space-y-3">
          <PoolPreviewCard viewModel={pool} hideEconomics />
          <Link href="/register" className="inline-flex h-11 items-center rounded-lg border-2 border-border-subtle bg-primary px-5 font-semibold text-primary-foreground shadow-sticker-sm">
            Make Your Pick
          </Link>
        </div>
      ) : (
        <div className="max-w-xl rounded-2xl border-2 border-dashed border-border-subtle p-8 text-center">
          <p className="font-semibold uppercase tracking-wide text-text-primary">Practice closed</p>
          <p className="mt-1 text-sm text-text-muted">The next practice session will appear here when it opens.</p>
        </div>
      )}
    </section>
  );
}
