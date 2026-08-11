-- Racing fork — Phase 2: additive pool adaptation.
--
-- Bridges the existing (already domain-agnostic) pool engine to the racing
-- event source WITHOUT touching entries/settlements/wallet or any money RPC,
-- and WITHOUT removing the football fixture path (still load-bearing until
-- Phase 4). Purely additive/relaxing:
--   * pools.race_id            — new nullable FK to races
--   * pools.fixture_id         — relaxed to nullable (was NOT NULL)
--   * pool_options.competitor_id — new nullable FK to competitors
--
-- No column is dropped or retyped; no trigger, constraint, index, grant, or
-- RLS policy on pools/pool_options/entries/settlements is altered. Existing
-- football pools (fixture_id set, competitor_id null) remain valid unchanged.

alter table public.pools
  add column race_id uuid references public.races (id);

alter table public.pools
  alter column fixture_id drop not null;

alter table public.pool_options
  add column competitor_id uuid references public.competitors (id);

create index idx_pools_race on public.pools (race_id);
create index idx_pool_options_competitor on public.pool_options (competitor_id);
