import type { HomeStandingRow } from "@/lib/landing/fetch";
import { CompetitorIdentity } from "@/components/racing/CompetitorIdentity";

/**
 * Meet the Grid — every marble in the championship with its permanent identity
 * (number + name + color) and current championship form (position, points,
 * wins). One consistent identity used everywhere on the page.
 */
export function MeetTheGrid({ grid }: { grid: HomeStandingRow[] }) {
  if (grid.length === 0) return null;
  return (
    <section id="grid" className="mx-auto max-w-6xl px-4 sm:px-6">
      <h2 className="mb-4 font-display text-2xl font-extrabold uppercase tracking-wide">The Grid</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {grid.map((row, i) => (
          <div
            key={row.marble.id || i}
            className="flex items-center justify-between gap-3 rounded-2xl border-2 border-border-subtle bg-surface-primary p-4 shadow-sticker"
          >
            <CompetitorIdentity competitor={row.marble} />
            <div className="flex shrink-0 items-center gap-3 text-sm">
              {row.position != null && (
                <span className="rounded-md bg-surface-secondary px-2 py-0.5 text-xs font-bold tabular-nums">
                  P{row.position}
                </span>
              )}
              <span className="tabular-nums">
                <span className="font-bold">{row.points}</span>
                <span className="text-text-muted"> pts</span>
              </span>
              {row.wins > 0 && (
                <span className="tabular-nums text-xs text-text-muted">{row.wins}W</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
