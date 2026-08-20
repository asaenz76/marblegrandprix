import Link from "next/link";
import type { HomeRound } from "@/lib/landing/fetch";
import { LocalDateTime } from "@/components/LocalDateTime";
import { CompetitorIdentity } from "@/components/racing/CompetitorIdentity";

/**
 * Upcoming Grand Prix calendar — only official championship rounds. The nearest
 * round is marked "This weekend"; completed rounds show their winner.
 */
export function UpcomingGrandPrix({ rounds }: { rounds: HomeRound[] }) {
  if (rounds.length === 0) return null;
  return (
    <section id="schedule" className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl font-extrabold">Upcoming Grand Prix</h2>
        <Link href="/register" className="text-sm font-semibold text-accent-primary hover:underline">
          Full schedule →
        </Link>
      </div>
      <ul className="space-y-3">
        {rounds.map((r, i) => (
          <li
            key={r.raceId}
            className="flex items-center justify-between gap-4 rounded-xl border-2 border-border-subtle bg-surface-primary p-4 shadow-sticker-sm"
          >
            <div className="flex min-w-0 items-center gap-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-primary text-sm font-bold text-white">
                {r.roundNumber ?? i + 1}
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold">{r.title} Grand Prix</p>
                {r.scheduledStartUtc && (
                  <p className="text-xs text-text-muted">
                    <LocalDateTime iso={r.scheduledStartUtc} options={{ weekday: "short", month: "short", day: "numeric" }} />
                  </p>
                )}
              </div>
            </div>
            <div className="shrink-0 text-right">
              {r.winner ? (
                <span className="inline-flex items-center gap-1.5 text-sm">
                  <span className="text-xs text-text-muted">Won by</span>
                  <CompetitorIdentity competitor={r.winner} size="sm" />
                </span>
              ) : i === 0 ? (
                <span className="inline-flex items-center rounded-full bg-accent-primary px-2.5 py-1 text-xs font-semibold text-white">
                  This weekend
                </span>
              ) : (
                <span className="text-xs font-medium text-text-muted">Scheduled</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
