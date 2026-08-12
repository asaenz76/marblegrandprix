"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finalizeCompetitionAction } from "@/lib/actions/competitions";
import { Button } from "@/components/ui/button";

/**
 * Finalize a Championship/League (Phase 7, §20). The winner is DERIVED from
 * standings — this button only asks the system to evaluate completion; it never
 * lets the user pick a champion. A tie/ambiguity/incompleteness returns a plain
 * explanation and changes nothing.
 */
export function FinalizeForm({ competitionId, eligible }: { competitionId: string; eligible: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  if (!eligible) return null;

  function finalize() {
    setMessage(null);
    startTransition(async () => {
      const res = await finalizeCompetitionAction({ competitionId });
      if (res.outcome === "finalized") {
        setOk(true);
        setMessage("Competition finalized. The champion is set and the Competition Winner pool is settling.");
        router.refresh();
        return;
      }
      setOk(false);
      setMessage(res.error ?? "Could not finalize the competition.");
    });
  }

  return (
    <div className="space-y-2">
      <Button type="button" onClick={finalize} disabled={pending}>
        {pending ? "Finalizing…" : "Finalize competition"}
      </Button>
      <p className="text-xs text-text-secondary">
        Requires every race to have a confirmed result. The champion is derived from the standings — a tie stays unresolved.
      </p>
      {message && <p className={`text-sm ${ok ? "text-success" : "text-danger"}`}>{message}</p>}
    </div>
  );
}
