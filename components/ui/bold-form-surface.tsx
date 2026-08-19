import { cn } from "@/lib/utils";

/**
 * The bold gold-ground form treatment used across Marble Grand Prix forms.
 *
 * On the FFC917 light ground, form cards blend into the ground (no white fill)
 * and every field — and, by default, the card edge — gets a crisp black
 * outline; secondary/muted text collapses to near-black (via the
 * `bold-form-text` class in globals.css) so labels and help text stay legible
 * on gold. Dark mode reverts to the standard subtle borders and restores the
 * tuned muted text, so the same wrapper is safe in both themes.
 *
 * Wrap a group of form Cards / fields in this. It only styles descendants that
 * carry the shared data-slots (card / input / textarea / checkbox) or a native
 * <select>, so plain content inside is untouched.
 *
 * `card`:
 *   "outline" (default) — black-outlined, ground-colored cards. Use for in-app
 *                         forms, admin panels, and multi-step wizards.
 *   "none"              — no card edge at all; the form floats directly on the
 *                         ground. Use for the centered auth screens.
 */
type CardStyle = "outline" | "none";

const FIELD_SCOPE = cn(
  "[&_[data-slot=input]]:border-black [&_[data-slot=textarea]]:border-black [&_[data-slot=checkbox]]:border-black [&_select]:border-black",
  "dark:[&_[data-slot=input]]:border-border-subtle dark:[&_[data-slot=textarea]]:border-border-subtle dark:[&_[data-slot=checkbox]]:border-border-subtle dark:[&_select]:border-border-subtle",
);

const CARD_SCOPE: Record<CardStyle, string> = {
  outline: cn(
    "[&_[data-slot=card]]:border-black [&_[data-slot=card]]:bg-transparent [&_[data-slot=card]]:shadow-none",
    "dark:[&_[data-slot=card]]:border-border-subtle",
  ),
  none: "[&_[data-slot=card]]:border-transparent [&_[data-slot=card]]:bg-transparent [&_[data-slot=card]]:shadow-none",
};

export function BoldFormSurface({
  card = "outline",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { card?: CardStyle }) {
  return (
    <div className={cn("bold-form-text", FIELD_SCOPE, CARD_SCOPE[card], className)} {...props}>
      {children}
    </div>
  );
}
