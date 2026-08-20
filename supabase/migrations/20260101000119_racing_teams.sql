-- Racing: Teams — an F1-style constructor layer over marbles. ADDITIVE ONLY.
--
-- A team ("constructor") has 1+ member competitors ("drivers"). The DRIVERS'
-- championship is the existing per-competitor standings (unchanged). The
-- CONSTRUCTORS' championship is a NEW read-only aggregation = the sum of a
-- team's members' points, computed live in application code from the existing
-- standings. Nothing here touches winners/grading/settlement/standings: those
-- all key on competitor_id and never see a team.
--
-- Named racing_teams / racing_team_members to avoid the LEGACY football
-- public.teams / public.team_players domain (migrations ...062, ...078).
--
-- Safe to apply BEFORE the code deploy: two new tables + one function, no
-- changes to existing tables and no backfill, so current production code keeps
-- working unchanged between this migration and the deploy that uses it.

-- racing_teams — the reusable team ("constructor") library row.
create table public.racing_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_url text,                       -- optional logo (racing-images bucket)
  color text,                           -- optional single accent (hex or css name), nullable
  is_active boolean not null default true,
  created_by uuid references public.user_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint racing_teams_name_not_blank check (length(btrim(name)) > 0)
);
create index idx_racing_teams_active on public.racing_teams (is_active);
create trigger racing_teams_set_updated_at before update on public.racing_teams
  for each row execute function public.set_updated_at();

-- racing_team_members — which marbles ("drivers") belong to a team.
-- UNIQUE(competitor_id) enforces the F1 rule: a driver is on at most one team.
-- competitor_id ON DELETE RESTRICT so a marble that is a team member cannot be
-- hard-deleted out from under the team (the competitor delete action already
-- soft-archives on FK conflict).
create table public.racing_team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.racing_teams (id) on delete cascade,
  competitor_id uuid not null references public.competitors (id) on delete restrict,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint racing_team_members_unique_pair unique (team_id, competitor_id),
  constraint racing_team_members_one_team_per_competitor unique (competitor_id)
);
create index idx_racing_team_members_team on public.racing_team_members (team_id, sort_order);

-- Atomic roster replacement in one round-trip (implicit statement transaction),
-- so a team's membership is never left half-updated. SECURITY INVOKER: runs as
-- the caller (the service role, via the Server Action) with no privilege
-- escalation — NOT SECURITY DEFINER.
create or replace function public.set_racing_team_members(
  p_team_id uuid,
  p_competitor_ids uuid[]
) returns void
language plpgsql
security invoker
as $$
begin
  delete from public.racing_team_members
   where team_id = p_team_id
     and not (competitor_id = any (p_competitor_ids));
  insert into public.racing_team_members (team_id, competitor_id, sort_order)
  select p_team_id, cid, ord - 1
    from unnest(p_competitor_ids) with ordinality as t(cid, ord)
  on conflict (team_id, competitor_id) do update set sort_order = excluded.sort_order;
end;
$$;

-- RLS + grants — mirror the competitors table exactly: authenticated may read,
-- all writes are service_role only (through Server Actions), anon nothing.
alter table public.racing_teams        enable row level security;
alter table public.racing_team_members enable row level security;

create policy "members_can_read_racing_teams"        on public.racing_teams        for select to authenticated using (true);
create policy "members_can_read_racing_team_members" on public.racing_team_members for select to authenticated using (true);

grant select on public.racing_teams        to authenticated;
grant select on public.racing_team_members to authenticated;

grant select, insert, update, delete on public.racing_teams        to service_role;
grant select, insert, update, delete on public.racing_team_members to service_role;
grant execute on function public.set_racing_team_members(uuid, uuid[]) to service_role;
