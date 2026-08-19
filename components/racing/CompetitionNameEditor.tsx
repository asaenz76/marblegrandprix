"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCompetitionNameAction } from "@/lib/actions/competitions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Rename a competition after creation. Collapsed to a small "Rename" button
 * next to the title; expands to an inline name field. Same manage-scope
 * (Organizer/Super Admin) as the other competition editors.
 */
export function CompetitionNameEditor({
  competitionId,
  name,
}: {
  competitionId: string;
  name: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(name);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateCompetitionNameAction({ competitionId, name: value.trim() });
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setValue(name);
          setOpen(true);
        }}
      >
        Rename
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border-subtle p-3">
      <div className="space-y-1">
        <Label htmlFor="competition-name">Competition name</Label>
        <Input
          id="competition-name"
          value={value}
          maxLength={120}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={save} disabled={pending || !value.trim()}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
