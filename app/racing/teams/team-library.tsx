"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TeamCluster } from "@/components/racing/TeamCluster";
import { TeamForm, type LibraryTeam } from "@/components/racing/TeamForm";
import type { LibraryCompetitor } from "@/components/racing/CompetitorForm";
import type { CompetitorIdentityData } from "@/components/racing/CompetitorIdentity";
import { deleteTeamAction } from "@/lib/actions/teams";

/**
 * Client manager for the racing teams library (constructors): add, inline-edit,
 * and remove. Server-rendered list is passed in; router.refresh() after each
 * mutation re-fetches the source of truth.
 */
export function TeamLibrary({
  teams,
  membersByTeam,
  library,
  membershipByCompetitor,
}: {
  teams: LibraryTeam[];
  membersByTeam: Record<string, CompetitorIdentityData[]>;
  library: LibraryCompetitor[];
  membershipByCompetitor: Record<string, { teamId: string; teamName: string }>;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const refresh = () => router.refresh();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          {teams.length} team{teams.length === 1 ? "" : "s"}
        </p>
        {!adding && (
          <Button
            size="sm"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
            }}
          >
            Add team
          </Button>
        )}
      </div>

      {adding && (
        <div className="rounded-md border border-border-subtle p-4">
          <TeamForm
            mode="create"
            library={library}
            membershipByCompetitor={membershipByCompetitor}
            onDone={() => {
              setAdding(false);
              refresh();
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {teams.length === 0 && !adding ? (
        <div className="rounded-md border border-border-subtle p-6 text-center text-sm text-text-secondary">
          No teams yet. Create one and add marbles from your competitors library.
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
          {teams.map((t) => (
            <li key={t.id} className="px-3 py-3">
              {editingId === t.id ? (
                <TeamForm
                  mode="edit"
                  initial={t}
                  library={library}
                  membershipByCompetitor={membershipByCompetitor}
                  onDone={() => {
                    setEditingId(null);
                    refresh();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <TeamCluster
                    team={{ name: t.name, color: t.color, imageUrl: t.imageUrl, members: membersByTeam[t.id] ?? [] }}
                  />
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingId(t.id);
                        setAdding(false);
                      }}
                    >
                      Edit
                    </Button>
                    <DeleteTeam id={t.id} onDone={refresh} />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DeleteTeam({ id, onDone }: { id: string; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Delete
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-xs text-destructive">{error}</span> : <span className="text-xs text-text-muted">Remove?</span>}
      <Button
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await deleteTeamAction({ id });
            if (res.error) {
              setError(res.error);
              return;
            }
            onDone();
          })
        }
      >
        {pending ? "Removing…" : "Remove"}
      </Button>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  );
}
