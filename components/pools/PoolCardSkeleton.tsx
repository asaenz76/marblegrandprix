// Loading placeholder for SocialPoolCard, shaped to match its real layout
// (identity header -> context line -> sentiment bar -> social row ->
// question -> option buttons -> footer line) so the feed/pool-detail route
// doesn't jump or reflow once real content streams in. Domain-neutral: the
// option rows each carry a leading circle so they read equally as a football
// team badge or a racing competitor swatch, and three rows sit between the
// football two-option card and an eight-competitor racing grid. Pure
// presentation, no props — every field is a fixed-width shimmer block.
export function PoolCardSkeleton() {
  return (
    <div
      className="animate-pulse space-y-3.5 rounded-2xl border border-border-subtle bg-surface-primary p-5"
      aria-hidden="true"
    >
      <div className="flex items-start gap-3">
        <span className="size-8 shrink-0 rounded-full bg-surface-elevated" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3.5 w-32 rounded bg-surface-elevated" />
          <div className="h-3 w-20 rounded bg-surface-elevated" />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="h-3.5 w-40 rounded bg-surface-elevated" />
        <div className="h-3 w-24 rounded bg-surface-elevated" />
      </div>

      <div className="h-2 w-full rounded-full bg-surface-elevated" />

      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          <span className="size-6 rounded-full bg-surface-elevated ring-2 ring-surface-primary" />
          <span className="size-6 rounded-full bg-surface-elevated ring-2 ring-surface-primary" />
          <span className="size-6 rounded-full bg-surface-elevated ring-2 ring-surface-primary" />
        </div>
        <div className="h-3.5 w-20 rounded bg-surface-elevated" />
      </div>

      <div className="space-y-1.5">
        <div className="h-5 w-4/5 rounded bg-surface-elevated" />
        <div className="h-4 w-24 rounded-full bg-surface-elevated" />
      </div>

      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex h-11 w-full items-center gap-3 rounded-xl border-2 border-border-subtle px-4"
          >
            <span className="size-4 shrink-0 rounded-full bg-surface-elevated" />
            <div className="h-3.5 w-28 rounded bg-surface-elevated" />
          </div>
        ))}
      </div>

      <div className="h-3 w-52 rounded bg-surface-elevated" />
    </div>
  );
}
