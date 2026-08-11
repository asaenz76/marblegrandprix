-- Racing fork — Phase 2: racing domain schema (additive foundation only).
--
-- Adds the racing event-source hierarchy that will (in later phases) replace
-- the football fixtures/teams/leagues source behind the already-generic
-- pool/settlement engine. Schema/domain foundation ONLY — no Server Actions,
-- no organizer authorization (Phase 3), no grading/settlement changes, no
-- progression engine (Phase 8). Nothing here touches money-moving tables or RPCs.
--
-- Security posture mirrors public.fixtures exactly: RLS enabled; authenticated
-- gets SELECT-only via a using(true) policy; service_role gets full CRUD;
-- anon gets nothing. The only functions added are plain (SECURITY INVOKER)
-- trigger functions for structural integrity — no SECURITY DEFINER, no RPCs,
-- no EXECUTE grants, no user_role changes.

-- ---------------------------------------------------------------------------
-- Enums (full value sets reserved now to avoid later ALTER TYPE).
-- ---------------------------------------------------------------------------
create type public.competition_format  as enum ('SINGLE_RACE', 'CHAMPIONSHIP', 'LEAGUE', 'BRACKET', 'ELIMINATION', 'MIXED');
create type public.competition_status  as enum ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');
create type public.stage_type          as enum ('RACE', 'POINTS_STANDINGS', 'GROUP', 'KNOCKOUT');
create type public.stage_status        as enum ('UPCOMING', 'ACTIVE', 'COMPLETED');
create type public.race_status         as enum ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'POSTPONED', 'CANCELLED', 'ABANDONED');
create type public.race_source_rule    as enum ('WINNER', 'POSITION');
-- Result-revision lifecycle: a DRAFT is being entered; exactly one CONFIRMED
-- revision is the current authoritative result per race; a corrected revision
-- pushes the prior CONFIRMED one to SUPERSEDED (history preserved, never overwritten).
create type public.race_result_status  as enum ('DRAFT', 'CONFIRMED', 'SUPERSEDED');
create type public.race_finish_status  as enum ('FINISHED', 'DNF', 'DSQ', 'DID_NOT_START');

-- ---------------------------------------------------------------------------
-- racing_competitions — top-level container. No organizer_id (ownership is the
-- Phase-3 competition_organizers join table). points_config drives live
-- standings (computed, not stored) for CHAMPIONSHIP/LEAGUE formats.
-- ---------------------------------------------------------------------------
create table public.racing_competitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  format public.competition_format not null,
  status public.competition_status not null default 'DRAFT',
  points_config jsonb not null default '{"1":10,"2":6,"3":4,"4":3,"5":2,"6":1}'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references public.user_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_racing_competitions_status on public.racing_competitions (status);
create trigger racing_competitions_set_updated_at before update on public.racing_competitions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- competition_stages — optional. SINGLE_RACE competitions have zero stages;
-- MIXED competitions have one row per phase. Ordering is explicit and unique.
-- advancement_rule is reserved for the Phase-8 progression engine (unused now).
-- ---------------------------------------------------------------------------
create table public.competition_stages (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.racing_competitions (id) on delete cascade,
  name text not null,
  stage_type public.stage_type not null,
  sequence_order integer not null,
  status public.stage_status not null default 'UPCOMING',
  advancement_rule jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competition_stages_unique_order unique (competition_id, sequence_order)
);

create index idx_competition_stages_competition on public.competition_stages (competition_id, sequence_order);
create trigger competition_stages_set_updated_at before update on public.competition_stages
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- races — the racing event primitive. Arbitrary N competitors (via
-- race_competitors). Winner truth lives in race_results, NOT here (single
-- source of truth). original_race_id links a rerun to the original.
-- (Defined before competitors because competitors.created_for_race_id -> races.)
-- ---------------------------------------------------------------------------
create table public.races (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.racing_competitions (id) on delete cascade,
  stage_id uuid references public.competition_stages (id) on delete set null,
  race_number integer,
  title text,
  scheduled_start_utc timestamptz,
  locks_at timestamptz,
  status public.race_status not null default 'SCHEDULED',
  video_url text,
  original_race_id uuid references public.races (id) on delete set null,
  created_by uuid references public.user_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_races_competition on public.races (competition_id);
create index idx_races_stage on public.races (stage_id);
create index idx_races_schedule on public.races (scheduled_start_utc, status);
create trigger races_set_updated_at before update on public.races
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- competitors — persistent (library) or race-only. Identified by any of
-- name / number / colors / image. Soft-deleted via is_active (never hard
-- deleted), so historical race data stays resolvable after deactivation.
--
-- Race-only scope is STRUCTURAL, not just a boolean:
--   * persistent  -> is_persistent = true  AND created_for_race_id IS NULL
--   * race-only    -> is_persistent = false AND created_for_race_id = <its race>
-- The created_for_race_id FK uses ON DELETE RESTRICT so a race carrying a
-- race-only competitor cannot be hard-deleted out from under its history (the
-- intended lifecycle is race.status = CANCELLED, not a destructive delete).
-- A trigger on race_competitors (below) enforces that a race-only competitor
-- may only ever participate in its originating race.
-- ---------------------------------------------------------------------------
create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  name text,
  number text,
  colors text[],
  image_url text,
  is_persistent boolean not null default true,
  created_for_race_id uuid references public.races (id) on delete restrict,
  is_active boolean not null default true,
  created_by uuid references public.user_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- At least one meaningful identifier must exist. (App-layer Zod will also
  -- enforce this later — defense in depth; here it is the Phase-2 backstop.)
  constraint competitors_has_identifier
    check (name is not null or number is not null or colors is not null or image_url is not null),
  -- 1..4 colors, order preserved by the array. Empty array (cardinality 0)
  -- and >4 are rejected; null means "no colors supplied".
  constraint competitors_colors_1_to_4
    check (colors is null or cardinality(colors) between 1 and 4),
  -- Scope consistency: persistent has no origin race; race-only names exactly one.
  constraint competitors_scope_consistent
    check (
      (is_persistent = true  and created_for_race_id is null)
      or (is_persistent = false and created_for_race_id is not null)
    )
);

create index idx_competitors_persistent_active on public.competitors (is_persistent, is_active);
create index idx_competitors_created_for_race on public.competitors (created_for_race_id);
create trigger competitors_set_updated_at before update on public.competitors
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- race_competitors — join: which competitors are in a race. competitor_id is
-- nullable ONLY for a progression placeholder slot (is_placeholder = true),
-- filled automatically from a source race in Phase 8. The unique(race_id,
-- competitor_id) both prevents duplicate competitors per race AND serves as
-- the FK target that proves result rows reference real participants.
-- ---------------------------------------------------------------------------
create table public.race_competitors (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races (id) on delete cascade,
  competitor_id uuid references public.competitors (id) on delete restrict,
  lane integer,
  sort_order integer not null default 0,
  -- Progression-slot metadata (schema foundation only; engine is Phase 8).
  is_placeholder boolean not null default false,
  source_race_id uuid references public.races (id) on delete set null,
  source_rule public.race_source_rule,
  source_position integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint race_competitors_unique_per_race unique (race_id, competitor_id),
  -- A filled slot must name a competitor; only a placeholder may omit it.
  constraint race_competitors_filled_has_competitor
    check (is_placeholder or competitor_id is not null)
);

create index idx_race_competitors_race on public.race_competitors (race_id);
create index idx_race_competitors_competitor on public.race_competitors (competitor_id);
create index idx_race_competitors_source_race on public.race_competitors (source_race_id);
create trigger race_competitors_set_updated_at before update on public.race_competitors
  for each row execute function public.set_updated_at();

-- Structural enforcement of race-only competitor scope: a competitor whose
-- created_for_race_id is set may only ever be attached to that one race.
-- SECURITY INVOKER (default) — not a privileged RPC, only fires on writes.
create or replace function public.enforce_race_only_competitor_scope()
returns trigger
language plpgsql
as $$
declare
  v_origin uuid;
begin
  if new.competitor_id is not null then
    select created_for_race_id into v_origin
      from public.competitors where id = new.competitor_id;
    if v_origin is not null and v_origin <> new.race_id then
      raise exception
        'race-only competitor % may only participate in its originating race %, not %',
        new.competitor_id, v_origin, new.race_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger race_competitors_enforce_scope
before insert or update on public.race_competitors
for each row execute function public.enforce_race_only_competitor_scope();

-- ---------------------------------------------------------------------------
-- race_results — VERSIONED. A race may have many revisions over time; history
-- is preserved, never overwritten. Exactly one revision per race may be
-- CONFIRMED (the current authoritative result) at a time. A correction inserts
-- a new revision (supersedes_result_id -> prior) and flips the prior to
-- SUPERSEDED. Winner required; the composite FK proves the winner is a
-- participant in that race. (No correction WORKFLOW here — schema only.)
-- ---------------------------------------------------------------------------
create table public.race_results (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races (id) on delete cascade,
  revision_number integer not null default 1,
  winner_competitor_id uuid not null,
  status public.race_result_status not null default 'DRAFT',
  supersedes_result_id uuid references public.race_results (id) on delete set null,
  confirmed_by uuid references public.user_profiles (id) on delete set null,
  confirmed_at timestamptz,
  superseded_at timestamptz,
  correction_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint race_results_unique_revision unique (race_id, revision_number),
  -- Composite-unique on (id, race_id) so result_positions can FK to it and
  -- guarantee a position's race matches its revision's race (no drift).
  constraint race_results_id_race unique (id, race_id),
  -- Winner must be a competitor participating in this race.
  constraint race_results_winner_in_race
    foreign key (race_id, winner_competitor_id)
    references public.race_competitors (race_id, competitor_id)
);

-- At most one authoritative CONFIRMED revision per race (superseded/draft history unbounded).
create unique index race_results_one_current_confirmed
  on public.race_results (race_id)
  where status = 'CONFIRMED';

create index idx_race_results_race on public.race_results (race_id, revision_number);
create trigger race_results_set_updated_at before update on public.race_results
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- race_result_positions — 0..N finishing places, owned by a specific result
-- REVISION (race_result_id), not the race. Winner-only = zero/one row; full
-- order = N rows; partial/unknown order allowed (nullable position). A
-- competitor appears at most once PER REVISION (not once forever), so v1 and
-- v2 may each list the same competitor.
--
-- NOTE: position is intentionally NOT uniquely constrained — a dead heat (two
-- competitors sharing a place) must be representable; tie resolution routes to
-- manual review in Phase 5/6, it is not a Phase-2 DB rule.
-- ---------------------------------------------------------------------------
create table public.race_result_positions (
  id uuid primary key default gen_random_uuid(),
  race_result_id uuid not null,
  race_id uuid not null,
  competitor_id uuid not null,
  position integer,
  finish_status public.race_finish_status not null default 'FINISHED',
  created_at timestamptz not null default now(),
  -- Same competitor may appear once PER revision (not once per race forever).
  constraint race_result_positions_unique_competitor unique (race_result_id, competitor_id),
  constraint race_result_positions_position_positive check (position is null or position >= 1),
  -- Belongs to a revision, and that revision's race matches this row's race.
  constraint race_result_positions_in_result
    foreign key (race_result_id, race_id)
    references public.race_results (id, race_id) on delete cascade,
  -- Competitor must be a participant in that race.
  constraint race_result_positions_competitor_in_race
    foreign key (race_id, competitor_id)
    references public.race_competitors (race_id, competitor_id)
);

create index idx_race_result_positions_result on public.race_result_positions (race_result_id);
create index idx_race_result_positions_race on public.race_result_positions (race_id);

-- ---------------------------------------------------------------------------
-- RLS + grants — mirror public.fixtures exactly (broad authenticated read;
-- all writes via service_role through future Server Actions). anon: nothing.
-- ---------------------------------------------------------------------------
alter table public.competitors            enable row level security;
alter table public.racing_competitions    enable row level security;
alter table public.competition_stages     enable row level security;
alter table public.races                  enable row level security;
alter table public.race_competitors       enable row level security;
alter table public.race_results           enable row level security;
alter table public.race_result_positions  enable row level security;

create policy "members_can_read_competitors"           on public.competitors           for select to authenticated using (true);
create policy "members_can_read_racing_competitions"   on public.racing_competitions   for select to authenticated using (true);
create policy "members_can_read_competition_stages"    on public.competition_stages    for select to authenticated using (true);
create policy "members_can_read_races"                 on public.races                 for select to authenticated using (true);
create policy "members_can_read_race_competitors"      on public.race_competitors      for select to authenticated using (true);
create policy "members_can_read_race_results"          on public.race_results          for select to authenticated using (true);
create policy "members_can_read_race_result_positions" on public.race_result_positions for select to authenticated using (true);

grant select on public.competitors            to authenticated;
grant select on public.racing_competitions    to authenticated;
grant select on public.competition_stages     to authenticated;
grant select on public.races                  to authenticated;
grant select on public.race_competitors       to authenticated;
grant select on public.race_results           to authenticated;
grant select on public.race_result_positions  to authenticated;

grant select, insert, update, delete on public.competitors            to service_role;
grant select, insert, update, delete on public.racing_competitions    to service_role;
grant select, insert, update, delete on public.competition_stages     to service_role;
grant select, insert, update, delete on public.races                  to service_role;
grant select, insert, update, delete on public.race_competitors       to service_role;
grant select, insert, update, delete on public.race_results           to service_role;
grant select, insert, update, delete on public.race_result_positions  to service_role;
