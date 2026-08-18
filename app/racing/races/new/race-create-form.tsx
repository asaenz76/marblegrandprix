"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createRaceAction } from "@/lib/actions/races";
import { CompetitorIdentity } from "@/components/racing/CompetitorIdentity";
import { RacingImageUploader } from "@/components/racing/RacingImageUploader";
import { ColorChips } from "@/components/racing/ColorChips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

type CompetitionOption = { id: string; name: string; format: string };
type LibraryCompetitor = { id: string; name: string | null; number: string | null; colors: string[] | null };
type SourceRace = { id: string; title: string | null };

type Row = {
  mode: "new" | "existing" | "slot"; // "slot" = Phase 8 progression placeholder
  existingCompetitorId: string;
  name: string;
  number: string;
  colorsText: string; // comma-separated, up to 4
  imageUrl: string;
  persistent: boolean;
  // Placeholder-slot fields:
  sourceRaceId: string;
  sourceRule: "WINNER" | "POSITION";
  sourcePosition: string;
};

const emptyRow = (): Row => ({ mode: "new", existingCompetitorId: "", name: "", number: "", colorsText: "", imageUrl: "", persistent: false, sourceRaceId: "", sourceRule: "WINNER", sourcePosition: "" });

export function RaceCreateForm({
  competitions,
  canCreateCompetition,
  library,
  racesByCompetition = {},
  lockedCompetitionId = null,
}: {
  competitions: CompetitionOption[];
  canCreateCompetition: boolean;
  library: LibraryCompetitor[];
  racesByCompetition?: Record<string, SourceRace[]>;
  // Phase 10: when adding a race from a competition page, the competition is
  // fixed — lock it and hide the competition picker / "new competition" toggle.
  lockedCompetitionId?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const lockedCompetition = lockedCompetitionId ? competitions.find((c) => c.id === lockedCompetitionId) ?? null : null;
  const [useNewCompetition, setUseNewCompetition] = useState(!lockedCompetition && canCreateCompetition && competitions.length === 0);
  const [competitionId, setCompetitionId] = useState(lockedCompetition?.id ?? competitions[0]?.id ?? "");
  const [newCompetitionName, setNewCompetitionName] = useState("");
  const [newCompetitionFormat, setNewCompetitionFormat] = useState<"SINGLE_RACE" | "CHAMPIONSHIP" | "LEAGUE" | "BRACKET" | "ELIMINATION">("SINGLE_RACE");

  // Source races available for a progression slot (only when adding to an
  // existing competition that already has races to advance from).
  const sourceRaces = !useNewCompetition ? racesByCompetition[competitionId] ?? [] : [];
  const [title, setTitle] = useState("");
  const [scheduledStart, setScheduledStart] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow()]);

  function update(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function submit() {
    setError(null);
    const competitors = rows.map((r) => {
      if (r.mode === "slot") {
        return {
          advancesFrom: {
            sourceRaceId: r.sourceRaceId,
            sourceRule: r.sourceRule,
            ...(r.sourceRule === "POSITION" && r.sourcePosition ? { sourcePosition: Number(r.sourcePosition) } : {}),
          },
        };
      }
      if (r.mode === "existing") return { existingCompetitorId: r.existingCompetitorId };
      const colors = r.colorsText.split(",").map((c) => c.trim()).filter(Boolean).slice(0, 4);
      return {
        name: r.name.trim() || undefined,
        number: r.number.trim() || undefined,
        colors: colors.length ? colors : undefined,
        imageUrl: r.imageUrl.trim() || undefined,
        persistent: r.persistent,
      };
    });

    const input = {
      ...(useNewCompetition ? { newCompetitionName: newCompetitionName.trim(), newCompetitionFormat } : { competitionId }),
      title: title.trim(),
      scheduledStartUtc: scheduledStart ? new Date(scheduledStart).toISOString() : undefined,
      videoUrl: videoUrl.trim() || undefined,
      imageUrl: imageUrl ?? undefined,
      competitors,
    };

    startTransition(async () => {
      const res = await createRaceAction(input as Parameters<typeof createRaceAction>[0]);
      if (res.error) setError(res.error);
      else router.push("/racing/races");
    });
  }

  return (
    <div className="space-y-6">
      {/* Competition context. When locked (adding from a competition page), we
          show the fixed competition and skip the picker entirely. */}
      {lockedCompetition ? (
        <input type="hidden" value={lockedCompetition.id} readOnly />
      ) : (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="text-sm font-semibold">Competition</h2>
          {canCreateCompetition && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={useNewCompetition} onChange={(e) => setUseNewCompetition(e.target.checked)} />
              Create a new standalone competition
            </label>
          )}
          {useNewCompetition ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="newComp">Competition name</Label>
                <Input id="newComp" value={newCompetitionName} onChange={(e) => setNewCompetitionName(e.target.value)} placeholder="Marble Grand Prix" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="newFormat">Format</Label>
                <select id="newFormat" className="w-full rounded-md border border-border-subtle bg-transparent px-3 py-2 text-sm" value={newCompetitionFormat} onChange={(e) => setNewCompetitionFormat(e.target.value as typeof newCompetitionFormat)}>
                  <option value="SINGLE_RACE">Single race</option>
                  <option value="CHAMPIONSHIP">Championship (points standings)</option>
                  <option value="LEAGUE">League (points standings)</option>
                  <option value="BRACKET">Bracket (single elimination)</option>
                  <option value="ELIMINATION">Elimination (position-based)</option>
                </select>
                <p className="text-xs text-text-secondary">Championship/League finalize from standings; Bracket/Elimination advance winners (or qualifying positions) round-by-round to a final race.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="comp">Competition</Label>
              <select id="comp" className="w-full rounded-md border border-border-subtle bg-transparent px-3 py-2 text-sm" value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
                {competitions.length === 0 && <option value="">No competitions you can manage</option>}
                {competitions.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Race details */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="text-sm font-semibold">Race</h2>
          <div className="space-y-1.5">
            <Label htmlFor="title">Race name</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Opening Race" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="start">Scheduled start</Label>
              <Input id="start" type="datetime-local" value={scheduledStart} onChange={(e) => setScheduledStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="video">Video / stream URL (optional)</Label>
              <Input id="video" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://…" />
            </div>
            <div className="space-y-1.5">
              <Label>Icon (optional)</Label>
              <RacingImageUploader value={imageUrl} onChange={(url) => setImageUrl(url)} label="icon" disabled={pending} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Competitors */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Competitors ({rows.length})</h2>
            <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, emptyRow()])}>+ Add competitor</Button>
          </div>

          {rows.map((r, i) => (
            <div key={i} className="space-y-2 rounded-md border border-border-subtle p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 text-xs">
                  <label className="flex items-center gap-1"><input type="radio" checked={r.mode === "new"} onChange={() => update(i, { mode: "new" })} /> New</label>
                  {library.length > 0 && (
                    <label className="flex items-center gap-1"><input type="radio" checked={r.mode === "existing"} onChange={() => update(i, { mode: "existing", existingCompetitorId: library[0].id })} /> From library</label>
                  )}
                  {sourceRaces.length > 0 && (
                    <label className="flex items-center gap-1"><input type="radio" checked={r.mode === "slot"} onChange={() => update(i, { mode: "slot", sourceRaceId: sourceRaces[0].id })} /> Advances from a race</label>
                  )}
                </div>
                {rows.length > 2 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>Remove</Button>
                )}
              </div>

              {r.mode === "slot" ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <select className="rounded-md border border-border-subtle bg-transparent px-3 py-2 text-sm" value={r.sourceRaceId} onChange={(e) => update(i, { sourceRaceId: e.target.value })}>
                    {sourceRaces.map((sr) => (<option key={sr.id} value={sr.id}>{sr.title ?? "Untitled race"}</option>))}
                  </select>
                  <select className="rounded-md border border-border-subtle bg-transparent px-3 py-2 text-sm" value={r.sourceRule} onChange={(e) => update(i, { sourceRule: e.target.value as "WINNER" | "POSITION" })}>
                    <option value="WINNER">Winner advances</option>
                    <option value="POSITION">Finishing position advances</option>
                  </select>
                  {r.sourceRule === "POSITION" && (
                    <Input type="number" min={1} placeholder="Position (e.g. 1)" value={r.sourcePosition} onChange={(e) => update(i, { sourcePosition: e.target.value })} />
                  )}
                </div>
              ) : r.mode === "existing" ? (
                <select className="w-full rounded-md border border-border-subtle bg-transparent px-3 py-2 text-sm" value={r.existingCompetitorId} onChange={(e) => update(i, { existingCompetitorId: e.target.value })}>
                  {library.map((c) => (
                    <option key={c.id} value={c.id}>{[c.number, c.name, (c.colors ?? []).join("/")].filter(Boolean).join(" · ") || "Competitor"}</option>
                  ))}
                </select>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Input placeholder="Name" value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
                    <Input placeholder="Number (#7)" value={r.number} onChange={(e) => update(i, { number: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-text-secondary">Colors (up to 4, optional)</span>
                    <ColorChips
                      value={r.colorsText.split(",").map((c) => c.trim()).filter(Boolean).slice(0, 4)}
                      onChange={(colors) => update(i, { colorsText: colors.join(", ") })}
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-text-secondary">Photo (optional)</span>
                    <RacingImageUploader value={r.imageUrl || null} onChange={(url) => update(i, { imageUrl: url ?? "" })} label="photo" disabled={pending} />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-text-secondary">
                      <input type="checkbox" checked={r.persistent} onChange={(e) => update(i, { persistent: e.target.checked })} />
                      Save this competitor for future races
                    </label>
                    <CompetitorIdentity
                      size="sm"
                      competitor={{ name: r.name, number: r.number, colors: r.colorsText.split(",").map((c) => c.trim()).filter(Boolean).slice(0, 4), imageUrl: r.imageUrl || null }}
                    />
                  </div>
                </>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" onClick={submit} disabled={pending}>{pending ? "Creating…" : "Create race"}</Button>
        <Button type="button" variant="outline" onClick={() => router.push("/racing/races")}>Cancel</Button>
      </div>
    </div>
  );
}
