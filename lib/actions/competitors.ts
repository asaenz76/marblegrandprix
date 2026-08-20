"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrganizerOrAbove } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit/log";
import {
  createCompetitorSchema,
  updateCompetitorSchema,
  type CreateCompetitorInput,
  type UpdateCompetitorInput,
} from "@/lib/validations/competitors";

/**
 * CRUD for the saved competitors library — persistent, shared marbles that
 * operators reuse when building races. The library has no owning competition,
 * so the gate is requireOrganizerOrAbove() (the same authority that already
 * creates persistent competitors inline during race creation). All writes go
 * through the service-role admin client; the browser never writes the
 * competitors table (RLS grants writes to service_role only).
 */

function identityRow(c: { name?: string; number?: string; colors?: string[]; imageUrl?: string }) {
  return {
    name: c.name ?? null,
    number: c.number ?? null,
    colors: c.colors ?? null,
    image_url: c.imageUrl ?? null,
  };
}

export async function createCompetitorAction(
  input: CreateCompetitorInput,
): Promise<{ error: string | null; id?: string }> {
  const actor = await requireOrganizerOrAbove();
  const parsed = createCompetitorSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid competitor." };

  const { data, error } = await createAdminClient()
    .from("competitors")
    .insert({ ...identityRow(parsed.data), is_persistent: true, is_active: true, created_by: actor.id })
    .select("id")
    .single();
  if (error || !data) return { error: "Could not save the competitor." };

  await writeAuditLog({
    actorId: actor.id,
    action: "competitor.created",
    entityType: "competitor",
    entityId: data.id,
    after: identityRow(parsed.data),
  });
  revalidatePath("/racing/competitors");
  return { error: null, id: data.id };
}

export async function updateCompetitorAction(input: UpdateCompetitorInput): Promise<{ error: string | null }> {
  const actor = await requireOrganizerOrAbove();
  const parsed = updateCompetitorSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid competitor." };

  // Only library (persistent) competitors are editable here; a race-only
  // competitor is owned by its race and edited through the race, not the library.
  const { error } = await createAdminClient()
    .from("competitors")
    .update(identityRow(parsed.data))
    .eq("id", parsed.data.id)
    .eq("is_persistent", true);
  if (error) return { error: "Could not update the competitor." };

  await writeAuditLog({
    actorId: actor.id,
    action: "competitor.updated",
    entityType: "competitor",
    entityId: parsed.data.id,
    after: identityRow(parsed.data),
  });
  revalidatePath("/racing/competitors");
  // A library competitor's identity (name/number/colors/photo) shows wherever
  // it races — the feed, landing, and any racing pool card.
  revalidatePath("/feed");
  revalidatePath("/");
  return { error: null };
}

export async function deleteCompetitorAction(input: { id: string }): Promise<{ error: string | null; archived?: boolean }> {
  const actor = await requireOrganizerOrAbove();
  if (!input?.id) return { error: "Missing competitor." };
  const admin = createAdminClient();

  // Prefer a real delete for a marble that was never used. If it has ever been
  // attached to a race or referenced by a pool, the ON DELETE RESTRICT foreign
  // keys reject it (Postgres 23503) — fall back to a soft archive so past
  // results stay resolvable (the schema never hard-deletes a referenced
  // competitor). Deactivating also drops it from the reuse picker automatically.
  const { error } = await admin.from("competitors").delete().eq("id", input.id).eq("is_persistent", true);
  if (!error) {
    await writeAuditLog({ actorId: actor.id, action: "competitor.deleted", entityType: "competitor", entityId: input.id });
    revalidatePath("/racing/competitors");
    return { error: null, archived: false };
  }
  if (error.code === "23503") {
    const { error: archiveError } = await admin
      .from("competitors")
      .update({ is_active: false })
      .eq("id", input.id)
      .eq("is_persistent", true);
    if (archiveError) return { error: "Could not remove the competitor." };
    await writeAuditLog({ actorId: actor.id, action: "competitor.archived", entityType: "competitor", entityId: input.id });
    revalidatePath("/racing/competitors");
    revalidatePath("/feed");
    revalidatePath("/");
    return { error: null, archived: true };
  }
  return { error: "Could not remove the competitor." };
}
