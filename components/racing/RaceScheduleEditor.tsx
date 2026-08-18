"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRaceScheduleAction } from "@/lib/actions/races";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ISO UTC <-> the value a <input type="datetime-local"> expects (local wall time),
// matching how the create form reads/writes scheduled start.
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Phase 19: edit a race's title + scheduled date/time after creation.
 */
export function RaceScheduleEditor({
  raceId,
  title,
  scheduledStartUtc,
}: {
  raceId: string;
  title: string;
  scheduledStartUtc: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(title);
  const [start, setStart] = useState(isoToLocalInput(scheduledStartUtc));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    const iso = start ? new Date(start).toISOString() : null;
    startTransition(async () => {
      const res = await updateRaceScheduleAction({ raceId, title: t.trim(), scheduledStartUtc: iso });
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Edit schedule
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border-subtle p-3">
      <div className="space-y-1">
        <Label htmlFor="race-title">Race title</Label>
        <Input id="race-title" value={t} onChange={(e) => setT(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="race-start">Scheduled start</Label>
        <Input id="race-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        {start && (
          <button type="button" className="text-xs text-text-muted hover:underline" onClick={() => setStart("")}>
            Clear date
          </button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={save} disabled={pending || !t.trim()}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
