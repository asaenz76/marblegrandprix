import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The Marble Grand Prix wordmark — the single source of truth for the brand
 * lockup, replacing the old inline "brohda." spans scattered across the shell,
 * landing, and auth screens. Rendered in the brand display face (Archivo
 * Expanded, --font-logo) in the deliberate brand navy so it reads as identity,
 * never as an interactive accent.
 *
 * The full name is three wide words, so `responsive` shows the "MGP" monogram
 * on narrow screens (e.g. the crowded app header on mobile) and the full
 * wordmark from the `sm` breakpoint up. Use `full` where there's always room
 * (landing, auth, footer) and `mark` for tight, icon-like slots.
 */
type WordmarkVariant = "full" | "mark" | "responsive";
type WordmarkSize = "sm" | "md" | "lg" | "xl";

const SIZE_CLASS: Record<WordmarkSize, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
  xl: "text-2xl",
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
  const classes = cn(
    "font-logo font-extrabold tracking-tight text-brand-navy",
    SIZE_CLASS[size],
    className,
  );

  const content =
    variant === "mark" ? (
      "MGP"
    ) : variant === "responsive" ? (
      <>
        <span className="sm:hidden">MGP</span>
        <span className="hidden sm:inline">Marble Grand Prix</span>
      </>
    ) : (
      "Marble Grand Prix"
    );

  if (href) {
    return (
      <Link href={href} className={classes} aria-label="Marble Grand Prix">
        {content}
      </Link>
    );
  }
  return <span className={classes}>{content}</span>;
}
