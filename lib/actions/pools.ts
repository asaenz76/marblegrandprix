"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin, requireAdminOrAbove, requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit/log";
import { getPoolLiveStats, type PoolLiveStats } from "@/lib/pools/fetch";
import { notifyFollowedPoolPublished } from "@/lib/email/notify-followed-pool-published";
import { getPoolPublishFollowRecipients } from "@/lib/pools/follow-recipients";
import { createPoolPublishedFollowNotifications } from "@/lib/notifications/create";
import { parseDollarsToCents, parsePercentToBps } from "@/lib/utils/money";
import { updatePoolSchema, voidEntrySchema, MINIMUM_LOCK_LEAD_MINUTES } from "@/lib/validations/pools";

function readPoolConfigFromForm(formData: FormData) {
  return {
    entryFeeCents: parseDollarsToCents(String(formData.get("entryFee") ?? "")),
    houseFeeBps: parsePercentToBps(String(formData.get("houseFeePercent") ?? "0")),
    visibility: String(formData.get("visibility") ?? "VISIBLE_TO_ALL_MEMBERS"),
    participationVisibility: String(
      formData.get("participationVisibility") ?? "SHOW_BEFORE_ENTRY",
    ),
    locksAt: String(formData.get("locksAt") ?? ""),
    overridePublishWarnings: formData.get("overridePublishWarnings") === "on",
  };
}

// Used by updatePoolAction — the only place a human still sets locks_at by
// hand on a fixture-backed (legacy football) pool. Not a DB constraint (see
// MINIMUM_LOCK_LEAD_MINUTES's own comment for why).
function isLockTooCloseToKickoff(locksAtIso: string, kickoffIso: string): boolean {
  const latestAllowed = new Date(kickoffIso).getTime() - MINIMUM_LOCK_LEAD_MINUTES * 60_000;
  return new Date(locksAtIso).getTime() > latestAllowed;
}

// A pool transitions DRAFT -> OPEN via publishPoolAction; the visibility guard
// and recipient resolution live here in one place. Skips HIDDEN (link-only)
// pools entirely — in-app included, not just email — since blasting
// notifications about an invite-only pool to arbitrary team/league followers
// who weren't invited would defeat the point of hiding it. Racing pools are
// created OPEN and have no fixture, so getPoolPublishFollowRecipients returns
// no recipients for them; this only ever fans out for legacy fixture-backed pools.
async function notifyFollowersOfPublish(pool: { id: string; question: string; fixtureId: string | null; visibility: string }) {
  if (pool.visibility !== "VISIBLE_TO_ALL_MEMBERS") return;

  const recipients = await getPoolPublishFollowRecipients(pool.fixtureId);
  if (recipients.length === 0) return;

  await createPoolPublishedFollowNotifications({
    poolId: pool.id,
    question: pool.question,
    recipientUserIds: recipients.map((r) => r.userId),
  });

  const emailUserIds = recipients.filter((r) => r.emailEnabled).map((r) => r.userId);
  await notifyFollowedPoolPublished({ pool: { id: pool.id, question: pool.question }, emailUserIds });
}

export type PublishPoolResult = { success: boolean; error: string | null };

export async function publishPoolAction(poolId: string): Promise<PublishPoolResult> {
  const admin = await requireAdminOrAbove();
  const adminClient = createAdminClient();

  const { data: before } = await adminClient.from("pools").select("*").eq("id", poolId).single();

  const { error } = await adminClient
    .from("pools")
    .update({ status: "OPEN" })
    .eq("id", poolId)
    .eq("status", "DRAFT");

  if (error) {
    return { success: false, error: "Could not publish this pool." };
  }

  await writeAuditLog({
    actorId: admin.id,
    action: "pool.published",
    entityType: "pool",
    entityId: poolId,
    before,
    after: { status: "OPEN" },
  });

  revalidatePath("/admin/pools");
  revalidatePath(`/admin/pools/${poolId}`);
  revalidatePath("/feed");

  if (before) {
    await notifyFollowersOfPublish({
      id: poolId,
      question: before.question as string,
      fixtureId: before.fixture_id as string | null,
      visibility: before.visibility as string,
    });
  }

  return { success: true, error: null };
}

export type UpdatePoolState = { error: string | null };

export async function updatePoolAction(
  _prevState: UpdatePoolState,
  formData: FormData,
): Promise<UpdatePoolState> {
  const admin = await requireAdminOrAbove();
  const adminClient = createAdminClient();

  const parsed = updatePoolSchema.safeParse({
    poolId: formData.get("poolId"),
    ...readPoolConfigFromForm(formData),
  });

  if (!parsed.success) {
    return { error: "Check the pool configuration — something's missing or invalid." };
  }

  const { data: before } = await adminClient
    .from("pools")
    .select("*")
    .eq("id", parsed.data.poolId)
    .single();

  if (!before) {
    return { error: "Pool not found." };
  }

  // Entry fee and Platform fee stay editable even after entries exist
  // (beta testing needs the fee droppable to 0% mid-pool) — everything
  // else that touches the entry window or who can see what is frozen once
  // money is committed, matching the DB trigger's own remaining checks.
  if (
    before.first_entry_at &&
    (new Date(parsed.data.locksAt).getTime() !== new Date(before.locks_at).getTime() ||
      parsed.data.visibility !== before.visibility ||
      parsed.data.participationVisibility !== before.participation_visibility)
  ) {
    return {
      error: "This pool already has entries — only the entry fee and Platform fee can change.",
    };
  }

  if (before.fixture_id) {
    const { data: fixture } = await adminClient
      .from("fixtures")
      .select("scheduled_start_utc")
      .eq("id", before.fixture_id)
      .single();

    if (fixture && isLockTooCloseToKickoff(parsed.data.locksAt, fixture.scheduled_start_utc)) {
      return {
        error: `Lock time must be at least ${MINIMUM_LOCK_LEAD_MINUTES} minutes before kickoff.`,
      };
    }
  }

  const { error } = await adminClient
    .from("pools")
    .update({
      entry_fee: parsed.data.entryFeeCents,
      house_fee_bps: parsed.data.houseFeeBps,
      visibility: parsed.data.visibility,
      participation_visibility: parsed.data.participationVisibility,
      locks_at: parsed.data.locksAt,
    })
    .eq("id", parsed.data.poolId);

  if (error) {
    return { error: "Could not update this pool." };
  }

  await writeAuditLog({
    actorId: admin.id,
    action: "pool.updated",
    entityType: "pool",
    entityId: parsed.data.poolId,
    before,
    after: parsed.data,
  });

  revalidatePath(`/admin/pools/${parsed.data.poolId}`);
  return { error: null };
}

export type VoidEntryState = { error: string | null };

export async function voidEntryAction(
  _prevState: VoidEntryState,
  formData: FormData,
): Promise<VoidEntryState> {
  const admin = await requireSuperAdmin();
  const adminClient = createAdminClient();

  const parsed = voidEntrySchema.safeParse({
    entryId: formData.get("entryId"),
    reason: formData.get("reason"),
    idempotencyKey: formData.get("idempotencyKey"),
  });

  if (!parsed.success) {
    return { error: "A reason is required." };
  }

  const { data: before } = await adminClient
    .from("entries")
    .select("*")
    .eq("id", parsed.data.entryId)
    .single();

  const { error } = await adminClient.rpc("void_pool_entry", {
    p_entry_id: parsed.data.entryId,
    p_admin_id: admin.id,
    p_reason: parsed.data.reason,
    p_idempotency_key: parsed.data.idempotencyKey,
  });

  if (error) {
    return { error: "Could not void this entry." };
  }

  await writeAuditLog({
    actorId: admin.id,
    action: "entry.voided",
    entityType: "entry",
    entityId: parsed.data.entryId,
    before,
    reason: parsed.data.reason,
  });

  if (before?.pool_id) {
    revalidatePath(`/admin/pools/${before.pool_id}`);
  }
  return { error: null };
}

/**
 * Called by `SocialPoolCard` after a realtime broadcast tells it someone
 * entered this pool — just needs a signed-in viewer, same as any other
 * pool read; `getPoolLiveStats` itself applies the real gating.
 */
export async function getPoolLiveStatsAction(poolId: string): Promise<PoolLiveStats | null> {
  await requireUser();
  return getPoolLiveStats(poolId);
}
