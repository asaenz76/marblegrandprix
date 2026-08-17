/**
 * One-time bootstrap for the first Super Admin account (spec §6.1: "One
 * admin account for MVP"). Invite-only registration has no path for the
 * very first user, since there's no admin yet to send an invitation.
 *
 * LOCAL (default):
 *   pnpm create-super-admin --email you@example.com --password 'xxxx' --name "Admin Name"
 *
 * PRODUCTION (one-time, explicit opt-in — see docs/DEPLOYMENT.md §4):
 *   ALLOW_PROD_BOOTSTRAP=1 \
 *   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
 *   pnpm create-super-admin --email you@example.com --password 'xxxx' --name "Admin" \
 *     --project-host <project-ref>.supabase.co
 *
 * This script is the ONE sanctioned exception to the local-only Supabase guard.
 * The exception is gated here (lib/dev/prod-bootstrap.ts), NOT by weakening
 * assertLocalSupabase — which stays absolute for seeds, dev-grading,
 * verification scripts, and the integration suite. A hosted target is refused
 * unless ALLOW_PROD_BOOTSTRAP=1 AND a --project-host that matches the target are
 * both present; and if a Super Admin already exists, it refuses safely.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { assessBootstrapTarget, superAdminExists } from "../lib/dev/prod-bootstrap";

// Not importing lib/supabase/admin.ts here: it's guarded by the `server-only`
// package, which throws unconditionally when required outside Next's
// `react-server` bundler condition — which is exactly the plain-Node
// context this script runs in via tsx. Build the same client inline instead.
function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

async function main() {
  const email = getArg("--email");
  const password = getArg("--password");
  const displayName = getArg("--name") ?? "Super Admin";

  if (!email || !password) {
    console.error(
      "Usage: pnpm create-super-admin --email you@example.com --password 'xxxx' --name \"Admin Name\"",
    );
    process.exit(1);
  }

  // --- Target gating (no DB connection yet) --------------------------------
  const assessment = assessBootstrapTarget({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    allowProdBootstrap: process.env.ALLOW_PROD_BOOTSTRAP === "1",
    expectedHost: getArg("--project-host") ?? process.env.EXPECTED_SUPABASE_HOST ?? null,
  });

  if (assessment.decision === "refused") {
    console.error(`⛔  ${assessment.reason}`);
    process.exit(1);
  }
  console.log(`Target Supabase host: ${assessment.host}`);
  if (assessment.decision === "prod-authorized") {
    console.log(
      "⚠️  PRODUCTION BOOTSTRAP AUTHORIZED — creating the first Super Admin against a hosted project.",
    );
  }

  const admin = createAdminClient();

  // --- Idempotency: one-time only ------------------------------------------
  if (await superAdminExists(admin)) {
    console.error(
      "A Super Admin already exists. Bootstrap is a one-time action and will not create another, modify the existing one, or reset credentials.",
    );
    process.exit(1);
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    console.error("Failed to create auth user:", createError?.message);
    process.exit(1);
  }

  const { error: profileError } = await admin.from("user_profiles").insert({
    id: created.user.id,
    display_name: displayName,
    role: "super_admin",
    is_active: true,
  });

  if (profileError) {
    console.error("Failed to create profile row:", profileError.message);
    process.exit(1);
  }

  console.log(`Super admin created: ${email} (${created.user.id})`);
}

main();
