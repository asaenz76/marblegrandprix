import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The Marble Grand Prix brand lockup — the single source of truth for the logo
 * across the shell, landing, auth, and footer. Renders the brand logo (the two
 * supplied SVGs: black for light mode, white for dark mode, swapped by the
 * theme's `.dark` class), replacing the earlier text wordmark.
 *
 * `size` controls the logo height. `responsive` renders a touch smaller on
 * narrow screens (the crowded app header on mobile). `variant` is kept for API
 * compatibility; there is no separate monogram — the logo is compact enough to
 * use everywhere.
 */
type WordmarkVariant = "full" | "mark" | "responsive";
type WordmarkSize = "sm" | "md" | "lg" | "xl";

const HEIGHT_CLASS: Record<WordmarkSize, string> = {
  sm: "h-5",
  md: "h-6",
  lg: "h-7",
  xl: "h-9",
};

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
  const heightClass = variant === "responsive" ? "h-6 sm:h-7" : HEIGHT_CLASS[size];

  const logo = (
    <span className={cn("inline-flex items-center", className)}>
      {/* Black lockup on light surfaces, white on dark — the two brand files. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-black.svg" alt="Marble Grand Prix" className={cn(heightClass, "w-auto dark:hidden")} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-white.svg" alt="" aria-hidden="true" className={cn(heightClass, "hidden w-auto dark:block")} />
    </span>
  );

  if (href) {
    return (
      <Link href={href} aria-label="Marble Grand Prix" className="inline-flex items-center">
        {logo}
      </Link>
    );
  }
  return logo;
}
