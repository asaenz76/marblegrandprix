"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown } from "lucide-react";
import { recordRaceResultAction, confirmRaceResultAction } from "@/lib/actions/race-results";
import { summarizeSettlementOutcomes } from "@/lib/racing/operator-labels";
import { CompetitorIdentity } from "@/components/racing/CompetitorIdentity";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Competitor = { id: string; name: string | null; number: string | null; colors: string[] | null };

/**
 * Organizer/Super-Admin result entry (Phase 6 + Phase 10 UX). Two modes:
 *   - Winner only (fast path): pick who won.
 *   - Full finishing order (optional): order every competitor 1st-first — needed
 *     for points standings and position-based elimination advancement.
 * Either way it's a two-step review -> confirm; confirming may grade/settle pools
 * automatically. The client never chooses the winning pool option or moves money.
 */
export function ResultForm({ raceId, competitors, alreadyConfirmed }: { raceId: string; competitors: Competitor[]; alreadyConfirmed: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [winnerId, setWinnerId] = useState(competitors[0]?.id ?? "");
  const [recordOrder, setRecordOrder] = useState(false);
  const [order, setOrder] = useState<Competitor[]>(competitors);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const winner = recordOrder ? order[0] : competitors.find((c) => c.id === winnerId);

  if (alreadyConfirmed) {
    return <p className="text-sm text-text-secondary">A result has already been confirmed for this race.</p>;
  }
  if (done) {
    return <p className="text-sm text-success">Result confirmed. {done}</p>;
  }

  function move(index: number, dir: -1 | 1) {
    setOrder((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  function confirm() {
    setError(null);
    const winnerCompetitorId = recordOrder ? order[0]?.id : winnerId;
    if (!winnerCompetitorId) return setError("Pick a winner first.");
    const positions = recordOrder ? order.map((c, i) => ({ competitorId: c.id, position: i + 1 })) : undefined;
    startTransition(async () => {
      const rec = await recordRaceResultAction({ raceId, winnerCompetitorId, positions });
      if (rec.error || !rec.resultId) return setError(rec.error ?? "Could not record the result.");
      const conf = await confirmRaceResultAction({ raceId, resultId: rec.resultId });
      if (conf.error) return setError(conf.error);
      setDone(summarizeSettlementOutcomes(conf.outcomes));
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {!recordOrder ? (
        <div className="space-y-1.5">
          <Label htmlFor="winner">Winner</Label>
          <select id="winner" className="w-full rounded-md border border-border-subtle bg-transparent px-3 py-2 text-sm" value={winnerId} onChange={(e) => { setWinnerId(e.target.value); setReviewing(false); }}>
            {competitors.map((c) => (
              <option key={c.id} value={c.id}>{[c.number, c.name, (c.colors ?? []).join("/")].filter(Boolean).join(" · ") || "Competitor"}</option>
            ))}
          </select>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>Finishing order (1st at the top)</Label>
          <ul className="space-y-1">
            {order.map((c, i) => (
              <li key={c.id} className="flex items-center gap-2 rounded-md border border-border-subtle px-2 py-1.5 text-sm">
                <span className="w-5 shrink-0 text-right tabular-nums text-text-secondary">{i + 1}</span>
                <span className="flex-1 min-w-0"><CompetitorIdentity competitor={c} size="sm" /></span>
                <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => { move(i, -1); setReviewing(false); }} className="rounded p-1 text-text-secondary hover:bg-surface-secondary disabled:opacity-30"><ChevronUp className="size-4" /></button>
                <button type="button" aria-label="Move down" disabled={i === order.length - 1} onClick={() => { move(i, 1); setReviewing(false); }} className="rounded p-1 text-text-secondary hover:bg-surface-secondary disabled:opacity-30"><ChevronDown className="size-4" /></button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input type="checkbox" checked={recordOrder} onChange={(e) => { setRecordOrder(e.target.checked); setReviewing(false); }} />
        Record the full finishing order (needed for standings points and position-based advancement)
      </label>

      {!reviewing ? (
        <Button type="button" onClick={() => setReviewing(true)} disabled={!winner}>Review result</Button>
      ) : (
        <div className="space-y-3 rounded-md border border-border-subtle p-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-text-secondary">Winner:</span>
            {winner && <CompetitorIdentity competitor={winner} />}
          </div>
          {recordOrder && <p className="text-xs text-text-secondary">Full finishing order will be recorded ({order.length} places).</p>}
          <p className="text-xs text-text-secondary">Confirming records this as the authoritative result and may grade and settle eligible pools. It can&apos;t be undone by an organizer.</p>
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
