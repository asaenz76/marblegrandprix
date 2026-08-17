import type { SupabaseClient } from "@supabase/supabase-js";
import { isLocalSupabaseUrl, supabaseHostname } from "./assert-local-supabase";

/**
 * Production Super-Admin bootstrap gating (Phase 14).
 *
 * Invite-only registration has no path for the very first user, so the first
 * Super Admin must be created by an operator script. That script (create-super-
 * admin.ts) is the ONE legitimate exception to the "local Supabase only" rule —
 * but the exception is scoped narrowly here, NOT by weakening assertLocalSupabase
 * (which stays absolute for seeds, dev-grading, verification scripts, and the
 * integration test suite). A hosted target is refused unless the operator has
 * supplied EVERY explicit safeguard, and ALLOW_PROD_BOOTSTRAP alone never
 * authorizes an arbitrary hosted project.
 *
 * This module makes no database connection — it only decides whether the
 * configured target may be bootstrapped, so the decision is unit-testable
 * without any Supabase (local or hosted).
 */
export type BootstrapAssessment =
  | { decision: "local"; host: string }
  | { decision: "prod-authorized"; host: string }
  | { decision: "refused"; host: string; reason: string };

export function assessBootstrapTarget(input: {
  url: string;
  allowProdBootstrap: boolean;
  expectedHost?: string | null;
}): BootstrapAssessment {
  const host = supabaseHostname(input.url);
  if (!host) {
    return { decision: "refused", host: "", reason: "NEXT_PUBLIC_SUPABASE_URL is missing or is not a valid URL." };
  }

  // Local target: unchanged behavior — always allowed.
  if (isLocalSupabaseUrl(input.url)) {
    return { decision: "local", host };
  }

  // Hosted target: refuse unless EVERY explicit production safeguard is present.
  if (!input.allowProdBootstrap) {
    return {
      decision: "refused",
      host,
      reason: `Refusing to bootstrap against a non-local Supabase (${host}). Production bootstrap requires ALLOW_PROD_BOOTSTRAP=1 AND an explicit --project-host that matches this target.`,
    };
  }

  const expected = (input.expectedHost ?? "").trim();
  if (!expected) {
    return {
      decision: "refused",
      host,
      reason: `ALLOW_PROD_BOOTSTRAP is set but no expected project host was supplied. Re-run with --project-host ${host} (or set EXPECTED_SUPABASE_HOST) to confirm the target on purpose.`,
    };
  }
  if (expected.toLowerCase() !== host.toLowerCase()) {
    return {
      decision: "refused",
      host,
      reason: `Target host (${host}) does not match the expected project host you supplied (${expected}). Refusing.`,
    };
  }

  return { decision: "prod-authorized", host };
}

/**
 * True if the target database already has an active Super Admin. Bootstrap is a
 * one-time action: if one exists, the script refuses rather than creating a
 * second or touching the existing account. `.limit(1)` keeps `.maybeSingle()`
 * safe even when several Super Admins exist.
 */
export async function superAdminExists(client: SupabaseClient): Promise<boolean> {
  const { data } = await client
    .from("user_profiles")
    .select("id")
    .eq("role", "super_admin")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  return !!data;
}
