"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createRacingPoolFromFormAction,
  type CreateRacingPoolFormState,
} from "@/lib/actions/racing-pools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INITIAL: CreateRacingPoolFormState = { error: null };

// Racing pools store an absolute instant (locks_at). The operator picks a
// wall-clock time in a datetime-local control; we convert to/from ISO in the
// browser so the instant reflects the operator's own timezone. Empty/invalid
// yields "" so the server rejects it with a plain-language message.
function isoToLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/**
 * Operator pool-creation form (Phase 13). Scope + context are fixed by the page
 * it renders on — a Race Winner pool on a race, a Competition Winner pool on a
 * competition — so the operator never picks a template. Minimal inputs: entry
 * fee, platform fee (prefilled 10%), lock time, and Public/Hidden visibility.
 * Delegates to the tested creation action; never touches money/grading.
 */
export function CreateRacingPoolForm({
  scope,
  raceId,
  competitionId,
  contextLabel,
  defaultLockIso,
}: {
  scope: "RACE" | "COMPETITION";
  raceId?: string;
  competitionId?: string;
  contextLabel: string;
  defaultLockIso?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lockLocal, setLockLocal] = useState(() => isoToLocalInput(defaultLockIso));
  const [stakes, setStakes] = useState<"CASH" | "FREE">("CASH");
  const [state, formAction, pending] = useActionState(createRacingPoolFromFormAction, INITIAL);

  // Refresh the page's server data so the new pool appears in the list above.
  useEffect(() => {
    if (state.poolId) router.refresh();
  }, [state.poolId, router]);

  if (state.poolId) {
    return (
      <p className="text-sm font-medium text-success">
        Pool created.{" "}
        <Link href={`/pool/${state.poolId}`} className="underline underline-offset-4">
          View pool →
        </Link>
      </p>
    );
  }

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Create pool
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border-subtle p-3">
      <input type="hidden" name="scope" value={scope} />
      {scope === "RACE" ? (
        <input type="hidden" name="raceId" value={raceId ?? ""} />
      ) : (
        <input type="hidden" name="competitionId" value={competitionId ?? ""} />
      )}
      <input type="hidden" name="locksAt" value={localInputToIso(lockLocal)} />

      <p className="text-xs text-text-muted">
        {scope === "RACE" ? "Race Winner pool" : "Competition Winner pool"} · {contextLabel}
      </p>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Pool type</legend>
        <div className="flex gap-4 text-sm text-text-secondary">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="stakes"
              value="CASH"
              checked={stakes === "CASH"}
              onChange={() => setStakes("CASH")}
            />{" "}
            Cash — play for money
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="stakes"
              value="FREE"
              checked={stakes === "FREE"}
              onChange={() => setStakes("FREE")}
            />{" "}
            Free — just for the leaderboard
          </label>
        </div>
      </fieldset>

      {stakes === "CASH" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="entryFee">Entry fee</Label>
            <div className="flex items-center gap-2">
              <span className="text-text-muted" aria-hidden="true">
                $
              </span>
              <Input id="entryFee" name="entryFee" inputMode="decimal" placeholder="5.00" required />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="platformFee">Platform fee</Label>
            <div className="flex items-center gap-2">
              <Input
                id="platformFee"
                name="platformFee"
                inputMode="decimal"
                defaultValue="10"
                className="max-w-24"
              />
              <span className="text-text-muted" aria-hidden="true">
                %
              </span>
            </div>
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="lock">Locks at</Label>
        <Input
          id="lock"
          type="datetime-local"
          value={lockLocal}
          onChange={(e) => setLockLocal(e.target.value)}
          required
        />
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Visibility</legend>
        <div className="flex gap-4 text-sm text-text-secondary">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="visibility" value="VISIBLE_TO_ALL_MEMBERS" defaultChecked />{" "}
            Public
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="visibility" value="HIDDEN" /> Hidden
          </label>
        </div>
      </fieldset>

      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create pool"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
