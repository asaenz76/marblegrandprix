"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCompetitionAction } from "@/lib/actions/competitions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RacingImageUploader } from "@/components/racing/RacingImageUploader";

type Format = "SINGLE_RACE" | "CHAMPIONSHIP" | "LEAGUE" | "BRACKET" | "ELIMINATION";

const FORMAT_HELP: Record<Format, string> = {
  SINGLE_RACE: "One race that stands on its own.",
  CHAMPIONSHIP: "Points across several races; finalized from the standings.",
  LEAGUE: "Points across several races; finalized from the standings.",
  BRACKET: "Single elimination — winners advance round by round to a final.",
  ELIMINATION: "Qualifying positions advance to the next round.",
};

/**
 * Standalone competition creation (Phase 10). Create the competition first, then
 * add races to it from its detail page — a clearer mental model than authoring a
 * competition inside the race form. Super-Admin-only (enforced server-side).
 */
export function CompetitionCreateForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [format, setFormat] = useState<Format>("CHAMPIONSHIP");
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createCompetitionAction({ name: name.trim(), format, imageUrl: imageUrl ?? undefined });
      if (res.error || !res.competitionId) return setError(res.error ?? "Could not create the competition.");
      router.push(`/racing/competitions/${res.competitionId}`);
    });
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Competition name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Marble Championship 2035" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="format">Format</Label>
        <select id="format" className="w-full rounded-md border border-border-subtle bg-transparent px-3 py-2 text-sm" value={format} onChange={(e) => setFormat(e.target.value as Format)}>
          <option value="CHAMPIONSHIP">Championship</option>
          <option value="LEAGUE">League</option>
          <option value="BRACKET">Bracket</option>
          <option value="ELIMINATION">Elimination</option>
          <option value="SINGLE_RACE">Single race</option>
        </select>
        <p className="text-xs text-text-secondary">{FORMAT_HELP[format]}</p>
      </div>
      <div className="space-y-1.5">
        <Label>Icon (optional)</Label>
        <RacingImageUploader value={imageUrl} onChange={(url) => setImageUrl(url)} label="icon" disabled={pending} />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" onClick={submit} disabled={pending || !name.trim()}>{pending ? "Creating…" : "Create competition"}</Button>
        <Button type="button" variant="outline" onClick={() => router.push("/racing/competitions")}>Cancel</Button>
      </div>
      <p className="text-xs text-text-muted">After creating, you&apos;ll add races from the competition page.</p>
    </div>
  );
}
