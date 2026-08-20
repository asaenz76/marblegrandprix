"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CompetitorIdentity } from "@/components/racing/CompetitorIdentity";
import { CompetitorForm, type LibraryCompetitor } from "@/components/racing/CompetitorForm";
import { deleteCompetitorAction } from "@/lib/actions/competitors";

/**
 * Client manager for the saved competitors library: add, inline-edit, and
 * remove. The list is server-rendered and passed in; after each mutation we
 * router.refresh() so the server component re-fetches the source of truth.
 */
export function CompetitorLibrary({ competitors }: { competitors: LibraryCompetitor[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = () => router.refresh();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          {competitors.length} saved competitor{competitors.length === 1 ? "" : "s"}
        </p>
        {!adding && (
          <Button
            size="sm"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
            }}
          >
            Add competitor
          </Button>
        )}
      </div>

      {adding && (
        <div className="rounded-md border border-border-subtle p-4">
          <CompetitorForm
            mode="create"
            onDone={() => {
              setAdding(false);
              refresh();
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {competitors.length === 0 && !adding ? (
        <div className="rounded-md border border-border-subtle p-6 text-center text-sm text-text-secondary">
          No saved competitors yet. Add one to reuse it across races.
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
          {competitors.map((c) => (
            <li key={c.id} className="px-3 py-3">
              {editingId === c.id ? (
                <CompetitorForm
                  mode="edit"
                  initial={c}
                  onDone={() => {
                    setEditingId(null);
                    refresh();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <CompetitorIdentity competitor={{ name: c.name, number: c.number, colors: c.colors, imageUrl: c.imageUrl }} />
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingId(c.id);
                        setAdding(false);
                      }}
                    >
                      Edit
                    </Button>
                    <DeleteCompetitor id={c.id} onDone={refresh} />
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

function DeleteCompetitor({ id, onDone }: { id: string; onDone: () => void }) {
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
      {error ? (
        <span className="text-xs text-destructive">{error}</span>
      ) : (
        <span className="text-xs text-text-muted">Remove?</span>
      )}
      <Button
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await deleteCompetitorAction({ id });
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
