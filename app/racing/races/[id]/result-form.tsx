"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordRaceResultAction, confirmRaceResultAction } from "@/lib/actions/race-results";
import { CompetitorIdentity } from "@/components/racing/CompetitorIdentity";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Competitor = { id: string; name: string | null; number: string | null; colors: string[] | null };

/**
 * Minimal Organizer/Super-Admin result entry (Phase 6, §16): pick the winner,
 * review, confirm. Confirmation grades and settles eligible pools automatically
 * — the client never chooses the winning option or moves money.
 */
export function ResultForm({ raceId, competitors, alreadyConfirmed }: { raceId: string; competitors: Competitor[]; alreadyConfirmed: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [winnerId, setWinnerId] = useState(competitors[0]?.id ?? "");
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const winner = competitors.find((c) => c.id === winnerId);

  if (alreadyConfirmed) {
    return <p className="text-sm text-text-secondary">A result has already been confirmed for this race.</p>;
  }
  if (done) {
    return <p className="text-sm text-success">Result confirmed. {done}</p>;
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const rec = await recordRaceResultAction({ raceId, winnerCompetitorId: winnerId });
      if (rec.error || !rec.resultId) return setError(rec.error ?? "Could not record the result.");
      const conf = await confirmRaceResultAction({ raceId, resultId: rec.resultId });
      if (conf.error) return setError(conf.error);
      const settled = Object.values(conf.outcomes ?? {});
      setDone(settled.length ? `Pools: ${settled.join(", ")}.` : "No pools to settle.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="winner">Winner</Label>
        <select id="winner" className="w-full rounded-md border border-border-subtle bg-transparent px-3 py-2 text-sm" value={winnerId} onChange={(e) => { setWinnerId(e.target.value); setReviewing(false); }}>
          {competitors.map((c) => (
            <option key={c.id} value={c.id}>{[c.number, c.name, (c.colors ?? []).join("/")].filter(Boolean).join(" · ") || "Competitor"}</option>
          ))}
        </select>
      </div>

      {!reviewing ? (
        <Button type="button" onClick={() => setReviewing(true)} disabled={!winnerId}>Review result</Button>
      ) : (
        <div className="space-y-3 rounded-md border border-border-subtle p-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-text-secondary">Winner:</span>
            {winner && <CompetitorIdentity competitor={winner} />}
          </div>
          <p className="text-xs text-text-secondary">Confirming will grade and settle any eligible pools. This cannot be undone by an organizer.</p>
          <div className="flex gap-2">
            <Button type="button" onClick={confirm} disabled={pending}>{pending ? "Confirming…" : "Confirm result"}</Button>
            <Button type="button" variant="outline" onClick={() => setReviewing(false)} disabled={pending}>Back</Button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
