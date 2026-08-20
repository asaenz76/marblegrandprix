"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColorChips } from "./ColorChips";
import { RacingImageUploader } from "./RacingImageUploader";
import { CompetitorIdentity } from "./CompetitorIdentity";
import { TeamCluster } from "./TeamCluster";
import type { LibraryCompetitor } from "./CompetitorForm";
import { createTeamAction, updateTeamAction } from "@/lib/actions/teams";

export type LibraryTeam = {
  id: string;
  name: string;
  imageUrl: string | null;
  color: string | null;
  memberIds: string[];
};

/**
 * Add/edit form for a racing team (constructor): a name, optional logo + accent
 * color, and a picker of member marbles from the competitor library. A marble
 * already on another team is disabled (a driver is on one team). Live preview
 * uses the shared TeamCluster.
 */
export function TeamForm({
  mode,
  initial,
  library,
  membershipByCompetitor,
  onDone,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: LibraryTeam;
  library: LibraryCompetitor[];
  /** competitorId -> the team it currently belongs to (any team). */
  membershipByCompetitor: Record<string, { teamId: string; teamName: string }>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(initial?.imageUrl ?? null);
  const [colors, setColors] = useState<string[]>(initial?.color ? [initial.color] : []);
  const [memberIds, setMemberIds] = useState<string[]>(initial?.memberIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const color = colors[0];
  const canSave = name.trim().length > 0 && memberIds.length >= 1;
  const byId = new Map(library.map((c) => [c.id, c]));
  const selectedMembers = memberIds.map((id) => byId.get(id)).filter(Boolean) as LibraryCompetitor[];

  function toggle(id: string) {
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function submit() {
    setError(null);
    const payload = {
      name: name.trim(),
      imageUrl: imageUrl ?? undefined,
      color: color ?? undefined,
      memberCompetitorIds: memberIds,
    };
    start(async () => {
      const res =
        mode === "create" ? await createTeamAction(payload) : await updateTeamAction({ id: initial!.id, ...payload });
      if (res.error) {
        setError(res.error);
        return;
      }
      onDone();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="block text-xs font-medium text-text-secondary">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Team Velocity" maxLength={80} />
        </label>
        <div className="space-y-1">
          <span className="block text-xs font-medium text-text-secondary">Accent color</span>
          <ColorChips value={colors} onChange={setColors} max={1} />
        </div>
      </div>

      <div className="space-y-1">
        <span className="block text-xs font-medium text-text-secondary">Logo</span>
        <RacingImageUploader value={imageUrl} onChange={(url) => setImageUrl(url)} label="logo" />
      </div>

      <div className="space-y-1">
        <span className="block text-xs font-medium text-text-secondary">Members ({memberIds.length})</span>
        {library.length === 0 ? (
          <p className="text-xs text-text-muted">No marbles in the library yet. Add competitors first.</p>
        ) : (
          <div className="max-h-64 divide-y divide-border-subtle overflow-y-auto rounded-md border border-border-subtle">
            {library.map((c) => {
              const selected = memberIds.includes(c.id);
              const membership = membershipByCompetitor[c.id];
              const takenElsewhere = membership && membership.teamId !== initial?.id;
              const disabled = Boolean(takenElsewhere) && !selected;
              return (
                <label
                  key={c.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-2.5 py-1.5",
                    disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={disabled}
                    onChange={() => toggle(c.id)}
                    className="size-4"
                  />
                  <CompetitorIdentity
                    competitor={{ name: c.name, number: c.number, colors: c.colors, imageUrl: c.imageUrl }}
                    size="sm"
                  />
                  {takenElsewhere && !selected && (
                    <span className="ml-auto text-xs text-text-muted">on {membership.teamName}</span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-md border border-border-subtle bg-surface-secondary px-3 py-2">
        <span className="mb-1 block text-xs text-text-muted">Preview</span>
        {selectedMembers.length > 0 || name.trim() ? (
          <TeamCluster
            team={{
              name: name.trim() || "Team",
              color: color ?? null,
              imageUrl,
              members: selectedMembers.map((m) => ({ name: m.name, number: m.number, colors: m.colors, imageUrl: m.imageUrl })),
            }}
          />
        ) : (
          <span className="text-xs text-text-muted">Name the team and pick its marbles</span>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button size="sm" disabled={!canSave || pending} onClick={submit}>
          {pending ? "Saving…" : mode === "create" ? "Save team" : "Save changes"}
        </Button>
        <Button variant="outline" size="sm" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
