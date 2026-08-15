// Route-segment loading state for the player race page (a pure async Server
// Component). Shape-matched to its real layout — title + context subline, then
// the Competitors / Result / Pools sections — so nothing jumps when the race,
// result, and pool queries resolve.
export default function RaceDetailLoading() {
  return (
    <div className="max-w-xl space-y-6" aria-busy="true" aria-label="Loading race">
      <div className="animate-pulse space-y-2">
        <div className="h-7 w-2/3 rounded bg-surface-elevated" />
        <div className="h-3.5 w-1/2 rounded bg-surface-elevated" />
      </div>

      {[0, 1].map((section) => (
        <div key={section} className="animate-pulse space-y-2.5">
          <div className="h-4 w-32 rounded bg-surface-elevated" />
          <div className="space-y-2 rounded-xl border border-border-subtle p-3">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-3">
                <span className="size-4 shrink-0 rounded-full bg-surface-elevated" />
                <div className="h-3.5 w-40 rounded bg-surface-elevated" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
