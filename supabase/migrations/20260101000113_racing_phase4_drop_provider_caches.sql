-- Racing fork — Phase 4: drop the API-Football provider-only cache tables.
--
-- With the provider client (lib/sports-data/api-football-provider.ts),
-- lib/actions/odds.ts and lib/actions/squads.ts removed in Phase 4, these two
-- provider-only tables have zero remaining writers/readers — verified: no
-- retained application code and no retained SQL function/view/policy references
-- them (only their own creation/grant migrations do). Subtraction-only.
--
-- DELIBERATELY NOT DROPPED HERE (deferred to the Phase-11 core cleanup):
--   * fixtures / teams / leagues                    — still support retained feed/grading code
--   * league_season_imports                         — still read by the
--       fixtures_available_for_pool_creation view, which fixture/pool tests and
--       the (now-dead, Phase-11-removable) football pool-creation functions in
--       lib/actions/pools.ts still compile against
--   * fixtures_available_for_pool_creation view     — same
--   * fixtures.sport / provider_events_payload etc. — core football columns

drop table if exists public.fixture_odds_cache;
drop table if exists public.provider_request_log;
