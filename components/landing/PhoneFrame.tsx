import { cn } from "@/lib/utils";

// bg/border use --inverted-surface (theme-invariant, see globals.css) —
// a phone's bezel is black regardless of whether the surrounding page is
// in light or dark mode, unlike bg-text-primary which would flip to a
// near-white bezel in dark mode.
//
// A fine gold (#ffc917) outline keeps the near-black bezel from vanishing
// against a dark ground: `onDark` (the always-dark showcase band) shows it in
// both themes; otherwise it appears only in dark mode, where the page ground
// itself goes near-black.
//
// Fixed height (not max-height): every showcase panel needs to be the
// same size regardless of how much content it holds (a 3-item leaderboard
// vs. a single chart), so short content just leaves empty space at the
// bottom of its screen rather than shrinking the whole phone.
export function PhoneFrame({ children, onDark = false }: { children: React.ReactNode; onDark?: boolean }) {
  return (
    <div
      className={cn(
        "relative mx-auto w-full max-w-[300px] rounded-[2.5rem] border-[6px] border-inverted-surface bg-inverted-surface p-2 shadow-2xl",
        onDark ? "ring-1 ring-[#ffc917]" : "dark:ring-1 dark:ring-[#ffc917]",
      )}
    >
      <div className="absolute left-1/2 top-2 h-5 w-24 -translate-x-1/2 rounded-full bg-inverted-surface" aria-hidden="true" />
      <div className="h-[560px] overflow-hidden rounded-[2rem] bg-background">
        <div className="h-[560px] overflow-y-auto p-3 pt-7">{children}</div>
      </div>
    </div>
  );
}
