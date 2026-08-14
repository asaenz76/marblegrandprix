"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { correctRaceResultAction } from "@/lib/actions/race-results";
import { summarizeSettlementOutcomes } from "@/lib/racing/operator-labels";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

type Competitor = { id: string; name: string | null; number: string | null; colors: string[] | null };

/**
 * SUPER-ADMIN-ONLY correction of a confirmed result (Phase 10 UX over Phase 6/8
 * machinery). Deliberately NOT normal editing: it's collapsed behind an
 * "exceptional action" affordance, warns that it reverses/re-settles money, and
 * surfaces the downstream dependency chain in plain language when the correction
 * is blocked (a downstream race already started/settled). It changes no
 * correction semantics — it only calls the existing correctRaceResultAction.
 */
export function CorrectionForm({ raceId, competitors }: { raceId: string; competitors: Competitor[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [newWinnerId, setNewWinnerId] = useState(competitors[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [blockedBy, setBlockedBy] = useState<Array<{ raceId: string; reasons: string[] }> | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (done) return <p className="text-sm text-success">Correction applied. {done}</p>;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-danger underline underline-offset-4 hover:opacity-80">
        Correct this result (Super Admin)
      </button>
    );
  }

  function apply() {
    setError(null);
    setBlockedBy(null);
    if (!reason.trim()) return setError("A correction reason is required.");
    startTransition(async () => {
      const res = await correctRaceResultAction({ raceId, newWinnerCompetitorId: newWinnerId, reason: reason.trim() });
      if (res.error) {
        setError(res.error);
        setBlockedBy(res.blockedBy ?? null);
        return;
      }
      setDone(summarizeSettlementOutcomes(res.outcomes));
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-danger/40 bg-danger/5 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-danger">
        <AlertTriangle className="size-4" /> Correct a confirmed result
      </div>
      <p className="text-xs text-text-secondary">
        This reverses any settled pools for this race and re-grades against the corrected result. It&apos;s blocked automatically if a
        later race has already started or settled, to avoid changing money that has already moved.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="newWinner">Corrected winner</Label>
        <select id="newWinner" className="w-full rounded-md border border-border-subtle bg-transparent px-3 py-2 text-sm" value={newWinnerId} onChange={(e) => setNewWinnerId(e.target.value)}>
          {competitors.map((c) => (
            <option key={c.id} value={c.id}>{[c.number, c.name, (c.colors ?? []).join("/")].filter(Boolean).join(" · ") || "Competitor"}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reason">Reason</Label>
        <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being corrected?" />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {blockedBy && blockedBy.length > 0 && (
        <div className="rounded-md border border-border-subtle bg-surface-primary p-2 text-xs text-text-secondary">
          <p className="font-medium text-text-primary">Blocked by downstream races:</p>
          <ul className="mt-1 list-disc pl-4">
            {blockedBy.map((b) => (
              <li key={b.raceId}>{b.reasons.join("; ")}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="destructive" onClick={apply} disabled={pending}>{pending ? "Applying…" : "Apply correction"}</Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
      </div>
    </div>
  );
}
