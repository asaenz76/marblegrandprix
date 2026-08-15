// Route-segment loading state for the player competition page (a pure async
// Server Component). Shape-matched to its real layout — name + format/status
// subline, then a standings/bracket/races block — so nothing jumps when the
// competition and standings queries resolve.
export default function CompetitionDetailLoading() {
  return (
    <div className="max-w-xl space-y-6" aria-busy="true" aria-label="Loading competition">
      <div className="animate-pulse space-y-2">
        <div className="h-7 w-1/2 rounded bg-surface-elevated" />
        <div className="h-3.5 w-40 rounded bg-surface-elevated" />
      </div>

      <div className="animate-pulse overflow-hidden rounded-xl border border-border-subtle">
        {[0, 1, 2, 3].map((row) => (
          <div
            key={row}
            className="flex items-center gap-3 border-t border-border-subtle px-4 py-3 first:border-t-0"
          >
            <div className="h-3.5 w-4 rounded bg-surface-elevated" />
            <span className="size-4 shrink-0 rounded-full bg-surface-elevated" />
            <div className="h-3.5 flex-1 rounded bg-surface-elevated" />
            <div className="h-3.5 w-8 rounded bg-surface-elevated" />
          </div>
        ))}
      </div>
    </div>
  );
}
