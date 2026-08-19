import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The Marble Grand Prix brand lockup — the single source of truth for the logo
 * across the shell, landing, auth, and footer. A neo-brutalist "sticker" badge
 * (an accent tile with stacked offset shadows and an "M" monogram) next to a
 * heavy uppercase display wordmark, matching the Reclaim-the-web theme lockup.
 * Replaces the earlier logo images — no SVG assets involved.
 *
 * `size` scales the whole lockup. `responsive` uses the large size but hides
 * the wordmark text on narrow screens (the crowded app header on mobile),
 * leaving just the badge. `mark` renders the badge alone.
 */
type WordmarkVariant = "full" | "mark" | "responsive";
type WordmarkSize = "sm" | "md" | "lg" | "xl";

const SIZES: Record<WordmarkSize, { box: string; mono: string; text: string; gap: string; radius: string }> = {
  sm: { box: "size-6", mono: "text-sm", text: "text-sm", gap: "gap-1.5", radius: "rounded-md" },
  md: { box: "size-7", mono: "text-base", text: "text-base", gap: "gap-2", radius: "rounded-md" },
  lg: { box: "size-8", mono: "text-lg", text: "text-lg", gap: "gap-2", radius: "rounded-lg" },
  xl: { box: "size-10", mono: "text-2xl", text: "text-2xl", gap: "gap-2.5", radius: "rounded-lg" },
};

function MarkBadge({ box, mono, radius }: { box: string; mono: string; radius: string }) {
  return (
    <span className={cn("relative inline-block shrink-0", box)} aria-hidden="true">
      {/* Stacked offset "sticker" shadows peeking out to the bottom-right. */}
      <span className={cn("absolute inset-0 translate-x-[3px] translate-y-[3px] bg-[#ffb93f]", radius)} />
      <span className={cn("absolute inset-0 translate-x-[1.5px] translate-y-[1.5px] bg-[#f76568]", radius)} />
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center border-2 border-border-subtle bg-accent-primary font-display font-extrabold leading-none text-white",
          "motion-safe:group-hover:[animation:brand-stamp-wiggle_360ms_cubic-bezier(0.34,1.56,0.64,1)_both]",
          radius,
          mono,
        )}
      >
        M
      </span>
    </span>
  );
}

export function Wordmark({
  href,
  variant = "full",
  size = "md",
  className,
}: {
  href?: string;
  variant?: WordmarkVariant;
  size?: WordmarkSize;
  className?: string;
}) {
  const s = variant === "responsive" ? SIZES.lg : SIZES[size];

  const lockup = (
    <span className={cn("inline-flex items-center", s.gap, className)}>
      <MarkBadge box={s.box} mono={s.mono} radius={s.radius} />
      {variant !== "mark" && (
        <span
          className={cn(
            "font-display font-extrabold uppercase leading-none tracking-tight text-text-primary",
            s.text,
            variant === "responsive" && "hidden sm:inline",
          )}
        >
          Marble Grand Prix
        </span>
      )}
    </span>
  );

  if (href) {
    return (
      <Link href={href} aria-label="Marble Grand Prix" className="group inline-flex items-center">
        {lockup}
      </Link>
    );
  }
  return lockup;
}
