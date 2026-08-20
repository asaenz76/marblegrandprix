"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColorChips } from "./ColorChips";
import { RacingImageUploader } from "./RacingImageUploader";
import { CompetitorIdentity } from "./CompetitorIdentity";
import { createCompetitorAction, updateCompetitorAction } from "@/lib/actions/competitors";

export type LibraryCompetitor = {
  id: string;
  name: string | null;
  number: string | null;
  colors: string[] | null;
  imageUrl: string | null;
};

/**
 * Add/edit form for a saved library competitor. Reuses the same identity inputs
 * as race authoring (name / number / ColorChips / photo) with a live
 * CompetitorIdentity preview. On success it calls onDone (the parent refreshes
 * the server-rendered list).
 */
export function CompetitorForm({
  mode,
  initial,
  onDone,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: LibraryCompetitor;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [number, setNumber] = useState(initial?.number ?? "");
  const [colors, setColors] = useState<string[]>(initial?.colors ?? []);
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.imageUrl ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const hasIdentifier = Boolean(name.trim() || number.trim() || colors.length > 0 || imageUrl);

  function submit() {
    setError(null);
    const payload = {
      name: name.trim() || undefined,
      number: number.trim() || undefined,
      colors: colors.length ? colors : undefined,
      imageUrl: imageUrl ?? undefined,
    };
    start(async () => {
      const res =
        mode === "create"
          ? await createCompetitorAction(payload)
          : await updateCompetitorAction({ id: initial!.id, ...payload });
      if (res.error) {
        setError(res.error);
        return;
      }
      onDone();
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="block text-xs font-medium text-text-secondary">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Crimson Comet" maxLength={80} />
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-medium text-text-secondary">Number</span>
          <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 7" maxLength={20} />
        </label>
      </div>

      <div className="space-y-1">
        <span className="block text-xs font-medium text-text-secondary">Colors</span>
        <ColorChips value={colors} onChange={setColors} />
      </div>

      <div className="space-y-1">
        <span className="block text-xs font-medium text-text-secondary">Photo</span>
        <RacingImageUploader value={imageUrl} onChange={(url) => setImageUrl(url)} label="photo" />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-surface-secondary px-3 py-2">
        <span className="text-xs text-text-muted">Preview</span>
        {hasIdentifier ? (
          <CompetitorIdentity competitor={{ name, number, colors, imageUrl }} />
        ) : (
          <span className="text-xs text-text-muted">Add a name, number, color, or photo</span>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button size="sm" disabled={!hasIdentifier || pending} onClick={submit}>
          {pending ? "Saving…" : mode === "create" ? "Save competitor" : "Save changes"}
        </Button>
        <Button variant="outline" size="sm" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
