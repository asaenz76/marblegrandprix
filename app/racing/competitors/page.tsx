import { requireOrganizerOrAbove } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { CompetitorLibrary } from "./competitor-library";
import type { LibraryCompetitor } from "@/components/racing/CompetitorForm";

// Saved competitors library (the marble library). Persistent, shared marbles
// operators reuse when building races. Accessible to any organizer/super-admin;
// the library has no owning competition, so it's a shared global resource — the
// same set the race-creation picker reads.
export default async function CompetitorsPage() {
  await requireOrganizerOrAbove();
  const client = createAdminClient();

  const { data } = await client
    .from("competitors")
    .select("id, name, number, colors, image_url")
    .eq("is_persistent", true)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(500);

  const competitors: LibraryCompetitor[] = (data ?? []).map((c) => ({
    id: c.id as string,
    name: (c.name as string | null) ?? null,
    number: (c.number as string | null) ?? null,
    colors: (c.colors as string[] | null) ?? null,
    imageUrl: (c.image_url as string | null) ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Competitors</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-secondary">
          Your saved marble library — reuse these when creating races. Deleting a marble that has never
          raced removes it outright; a marble that has already appeared in a race is archived instead, so
          past results stay intact.
        </p>
      </div>
      <CompetitorLibrary competitors={competitors} />
    </div>
  );
}
