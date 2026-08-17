/**
 * Integration coverage for the Phase 14 bootstrap idempotency check. The
 * create-super-admin script refuses to create a second Super Admin; this
 * verifies the underlying `superAdminExists` query runs against the real schema
 * and reports true when an active Super Admin is present. Run: pnpm test:integration.
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { superAdminExists } from "@/lib/dev/prod-bootstrap";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const admin = createSupabaseClient(URL, SR, { auth: { autoRefreshToken: false, persistSession: false } });

describe.skipIf(!SR)("Phase 14 — bootstrap idempotency query", () => {
  it("superAdminExists reports true once an active Super Admin exists", async () => {
    const { data } = await admin.auth.admin.createUser({
      email: `bootcheck-${randomUUID().slice(0, 8)}@example.com`,
      password: "test-password-123",
      email_confirm: true,
    });
    await admin.from("user_profiles").insert({ id: data!.user!.id, display_name: "sa", role: "super_admin", is_active: true });

    expect(await superAdminExists(admin)).toBe(true);
  });
});
