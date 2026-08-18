"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteCompetitionAction } from "@/lib/actions/competitions";
import { deleteRaceAction } from "@/lib/actions/races";

/**
 * Phase 17: Super-Admin delete for a competition or race, with a type-the-name
 * confirmation. Destructive and irreversible — the copy says so, and the
 * confirm button stays disabled until the exact name is typed.
 */
export function DeleteRacingEntityButton({
  kind,
  id,
  name,
}: {
  kind: "competition" | "race";
  id: string;
  name: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canConfirm = confirmText.trim() === name.trim() && name.trim().length > 0;

  function doDelete() {
    setError(null);
    startTransition(async () => {
      const res =
        kind === "competition"
          ? await deleteCompetitionAction({ competitionId: id })
          : await deleteRaceAction({ raceId: id });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push(kind === "competition" ? "/racing/competitions" : "/racing/races");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="destructive" size="sm" onClick={() => setOpen(true)}>
        Delete {kind}
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-destructive/40 p-3">
      <p className="text-sm text-text-secondary">
        This permanently deletes the {kind} and everything under it (
        {kind === "competition" ? "races, competitors, and pools" : "competitors and pools"}). Any live
        entries are refunded. This cannot be undone.
      </p>
      <p className="text-sm">
        Type <span className="font-semibold text-text-primary">{name}</span> to confirm:
      </p>
      <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={name} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="destructive" size="sm" disabled={!canConfirm || pending} onClick={doDelete}>
          {pending ? "Deleting…" : `Delete ${kind}`}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setConfirmText("");
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
