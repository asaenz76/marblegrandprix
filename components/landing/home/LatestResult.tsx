import type { HomepageData } from "@/lib/landing/fetch";
import { CompetitorIdentity } from "@/components/racing/CompetitorIdentity";

const PODIUM_LABEL = ["1st", "2nd", "3rd"];

/**
 * Latest Grand Prix result — winner + podium. Only official Grand Prix results
 * appear here; Practice winners are never mixed in.
 */
export function LatestResult({ result }: { result: HomepageData["latestResult"] }) {
  if (!result) return null;
  const podium = result.podium.length ? result.podium : result.winner ? [result.winner] : [];
  if (podium.length === 0) return null;

  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6">
      <h2 className="mb-4 font-display text-2xl font-extrabold">Latest Grand Prix result</h2>
      <div className="rounded-2xl border-2 border-border-subtle bg-surface-primary p-6 shadow-sticker">
        <p className="text-sm text-text-muted">
          {result.round.title} Grand Prix
          {result.round.roundNumber != null ? ` · Round ${result.round.roundNumber}` : ""}
        </p>
        <ol className="mt-4 space-y-2">
          {podium.map((marble, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="w-8 shrink-0 text-sm font-bold text-text-muted">{PODIUM_LABEL[i] ?? `${i + 1}th`}</span>
              <CompetitorIdentity competitor={marble} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
