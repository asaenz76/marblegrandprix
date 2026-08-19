import { cn } from "@/lib/utils";

/**
 * Form wrapper kept for API compatibility across the form pages. In the current
 * cream theme, form cards render as normal Cards (cream surface, ink border,
 * offset shadow), so the default is a passthrough; `card="none"` still lets a
 * centered form (the auth screens) float without a card box.
 */
type CardStyle = "outline" | "none";

const CARD_SCOPE: Record<CardStyle, string> = {
  outline: "",
  none: "[&_[data-slot=card]]:border-transparent [&_[data-slot=card]]:bg-transparent [&_[data-slot=card]]:shadow-none",
};

export function BoldFormSurface({
  card = "outline",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { card?: CardStyle }) {
  return (
    <div className={cn(CARD_SCOPE[card], className)} {...props}>
      {children}
    </div>
  );
}
