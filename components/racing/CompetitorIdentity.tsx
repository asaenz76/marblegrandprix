import { cn } from "@/lib/utils";

export type CompetitorIdentityData = {
  name?: string | null;
  number?: string | null;
  colors?: string[] | null;
  imageUrl?: string | null;
};

/**
 * Reusable visual identity for a racing competitor (Phase 4, §8).
 *
 * A competitor need not have a name, an image, or a crest — it may be
 * identified by any of name / number / up to four colors / image. This renders
 * whatever identity exists, clearly and consistently:
 *   Red   ·   #7   ·   Red / White   ·   #7 Red / White / Blue
 *   Lightning   ·   #7 Lightning — Red / Black / Gold   ·   #12
 *
 * Reusable later on race cards, prediction options, results, standings —
 * but those surfaces are not built here.
 */
export function CompetitorIdentity({
  competitor,
  size = "md",
  className,
}: {
  competitor: CompetitorIdentityData;
  size?: "sm" | "md";
  className?: string;
}) {
  const colors = (competitor.colors ?? []).slice(0, 4);
  const label = competitor.name?.trim() || null;
  const number = competitor.number?.trim() || null;
  const swatch = size === "sm" ? "h-3 w-3" : "h-4 w-4";

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      {competitor.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={competitor.imageUrl}
          alt=""
          className={cn("rounded-full object-cover", size === "sm" ? "h-5 w-5" : "h-6 w-6")}
        />
      ) : colors.length > 0 ? (
        <span className="inline-flex items-center gap-0.5" aria-hidden>
          {colors.map((c, i) => (
            // The ring is a theme-contrasting hairline (dark on light surfaces,
            // light on dark) so a swatch whose fill matches the theme — white
            // on light, black/navy on dark — never visually disappears.
            // Competitor colors are product data and are rendered exactly as
            // stored; the ring is what guarantees separation, not a recolor.
            <span
              key={i}
              className={cn(swatch, "rounded-full")}
              style={{
                backgroundColor: cssColor(c),
                boxShadow: "0 0 0 1.5px var(--competitor-ring)",
              }}
              title={c}
            />
          ))}
        </span>
      ) : null}

      {number && (
        <span className={cn("font-semibold tabular-nums", size === "sm" ? "text-xs" : "text-sm")}>{number}</span>
      )}
      {label && <span className={cn(size === "sm" ? "text-xs" : "text-sm")}>{label}</span>}

      {/* Ensure something is always shown even for colors-only competitors:
          the color names, when there is no name/number/image. */}
      {!label && !number && !competitor.imageUrl && colors.length > 0 && (
        <span className={cn("text-text-secondary", size === "sm" ? "text-xs" : "text-sm")}>{colors.join(" / ")}</span>
      )}
    </span>
  );
}

// Map a user-entered color to a CSS value. Named CSS colors ("Red", "Gold")
// render directly; a hex value ("#7A1B2C") passes through; anything else falls
// back to a neutral swatch so the UI never breaks on free-text input.
function cssColor(input: string): string {
  const v = input.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v;
  if (/^[a-z]+$/i.test(v)) return v.toLowerCase();
  return "var(--color-border-strong, #888)";
}
