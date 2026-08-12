-- Racing fork — Phase 3: add the 'organizer' role.
--
-- Single-statement migration in its own file: Postgres cannot use a new enum
-- value in the same transaction that adds it, and the Supabase CLI wraps each
-- migration file in one transaction (same reason 'admin' got its own file in
-- 20260101000020_admin_role.sql).
--
-- Target product role model: super_admin | organizer | player.
--   * super_admin — the ONLY global privileged role.
--   * organizer   — competition-scoped authority only (via competition_organizers).
--   * player      — normal consumer.
-- The inherited 'admin' value remains in the enum for legacy compatibility
-- (LEGACY TECHNICAL ROLE — NO NEW PRODUCT USE); it is NOT granted organizer or
-- super_admin authority by implication. No new users are assigned 'admin'
-- (lib/validations/users.ts now only permits player/organizer).

alter type public.user_role add value 'organizer';
