/**
 * Developer-safety guard (Phase 4 isolation fix).
 *
 * Local destructive/test workflows — integration tests, seed scripts, the
 * super-admin bootstrap — must target the LOCAL Supabase stack (127.0.0.1),
 * never a hosted database. Filename/convention alone proved insufficient (a
 * hosted URL had silently landed in .env.local), so this guard refuses to run
 * such a command when the configured Supabase URL is not local.
 *
 * This is a developer-only mechanism: it is imported ONLY by test setup and
 * CLI scripts, never by the app/runtime, so it does not affect legitimate
 * production deployment or runtime behavior.
 */

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "0.0.0.0", "::1"]);

/** The hostname of a Supabase URL, or "" if it isn't a valid URL. */
export function supabaseHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * True only when the Supabase URL points at the local dev stack. Exported so
 * the one legitimate exception to the local-only rule — the first-Super-Admin
 * bootstrap (lib/dev/prod-bootstrap.ts) — can share the exact same definition
 * of "local" rather than reimplement it. This does NOT relax assertLocalSupabase
 * for any of its callers; that guard is unchanged and still absolute.
 */
export function isLocalSupabaseUrl(url: string): boolean {
  return LOCAL_HOSTS.has(supabaseHostname(url));
}

/** Throw loudly unless NEXT_PUBLIC_SUPABASE_URL points at a local Supabase stack. */
export function assertLocalSupabase(context = "this local command"): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const host = supabaseHostname(url);
  if (LOCAL_HOSTS.has(host)) return;

  throw new Error(
    [
      "",
      `⛔  Refusing to run ${context} against a NON-LOCAL Supabase URL (host: ${host || "unset"}).`,
      "    Local test/seed/dev commands must target the local Supabase stack (127.0.0.1).",
      "    Fix: point NEXT_PUBLIC_SUPABASE_URL at the local stack — see `.env.local` and `pnpm supabase status`.",
      "    (This guard prevents accidental hosted-database access.)",
      "",
    ].join("\n"),
  );
}
