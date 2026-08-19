import type { LandingLeaderboardEntry } from "@/lib/landing/fetch";
import { Avatar } from "@/components/Avatar";

/**
 * Player leaderboard — the humans calling races best. Kept visually and
 * verbally distinct from the marble championship standings (acceptance
 * criteria: players and marbles are never conflated), and placed low as a
 * secondary, community signal.
 */
export function PlayerLeaderboard({ entries }: { entries: LandingLeaderboardEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section id="community" className="mx-auto max-w-6xl px-4 sm:px-6">
      <h2 className="font-display text-2xl font-extrabold">Player leaderboard</h2>
      <p className="mb-4 mt-1 text-sm text-text-secondary">
        The people calling races best — separate from the marble championship.
      </p>
      <ol className="max-w-xl space-y-2">
        {entries.map((e) => (
          <li
            key={e.userId}
            className="flex items-center gap-3 rounded-xl border-2 border-border-subtle bg-surface-primary p-3 shadow-sticker-sm"
          >
            <span className="w-6 text-center font-bold tabular-nums text-text-muted">{e.rank}</span>
            <Avatar displayName={e.displayName} avatarUrl={e.avatarUrl} size="sm" />
            <span className="min-w-0 flex-1 truncate font-medium">{e.displayName}</span>
            <span className="shrink-0 text-sm tabular-nums text-text-secondary">
              {e.correctCount}/{e.totalCount}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
