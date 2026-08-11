-- Racing fork — Phase 1: remove the automated football ingestion infrastructure.
--
-- Subtraction-only. Drops ONLY provider/import objects proven unused by any
-- retained code (verified: no retained module, view, function, trigger, policy,
-- or foreign key references these). The application-code counterparts
-- (lib/competitions/**, the 4 import crons, lib/actions/{competitions,fixtures,
-- fixture-discovery}, admin/competitions|fixtures|fixture-archive) are removed
-- in the same phase.
--
-- DELIBERATELY NOT DROPPED HERE (temporary bridge dependencies — removed in
-- Phase 4/5 once the racing replacement severs the call graph):
--   * fixtures / teams / leagues                — retained core (Stage C / Phase 11)
--   * fixture_odds_cache                        — still written by retained lib/actions/odds.ts
--   * provider_request_log                      — still written by retained lib/sports-data/provider-gateway.ts
--   * league_season_imports                     — still read by the retained
--                                                 fixtures_available_for_pool_creation view (migration 000095),
--                                                 which the Phase-4 pool-creation wizard depends on
--
-- Functions dropped before tables because they return the table row types.

-- Import-processing RPCs (also de-listed from tests/integration/rpc-privilege-boundary.test.ts).
drop function if exists public.claim_import_job_chunks(integer, integer);
drop function if exists public.recalculate_import_job_progress(uuid, integer);
drop function if exists public.cleanup_import_job_chunk_payloads(interval);

-- Import-job tables (child before parent; chunks.job_id -> jobs on delete cascade).
drop table if exists public.competition_import_job_chunks;
drop table if exists public.competition_import_jobs;

-- Provider discovery/availability caches (only readers/writers were removed modules).
drop table if exists public.competition_availability_cache;
drop table if exists public.fixture_date_search_cache;
