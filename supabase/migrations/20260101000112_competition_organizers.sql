-- Racing fork — Phase 3: competition_organizers (many-to-many assignment).
--
-- Ownership of a racing competition is expressed ENTIRELY through this join
-- table (racing_competitions has no organizer_id). A Super Admin assigns one
-- or more organizers to a competition; an organizer may hold many competitions.
-- Assignment grants scoped management of that competition and its descendants
-- (stages/races/competitors/results/racing pools) — resolved by walking a
-- descendant back to its parent competition (in application code).
--
-- Authorization data is SERVICE-ROLE ONLY: no authenticated/anon grant, no
-- authenticated policy. The authz check runs server-side with the service-role
-- client (Server Action pattern) — never a browser-side read of who is assigned.
-- No SECURITY DEFINER function, no RPC, no EXECUTE grant, no privilege widening.

create table public.competition_organizers (
  competition_id uuid not null references public.racing_competitions (id) on delete cascade,
  organizer_id   uuid not null references public.user_profiles (id)       on delete cascade,
  assigned_by    uuid references public.user_profiles (id)                on delete set null,
  assigned_at    timestamptz not null default now(),
  primary key (competition_id, organizer_id)
);

-- competition -> organizers is served by the PK's leading column; add the
-- reverse lookup (organizer -> competitions) used by the authorization check.
create index idx_competition_organizers_organizer on public.competition_organizers (organizer_id);

-- Only a user whose role is exactly 'organizer' may be assigned. This blocks
-- assigning a player, a legacy 'admin', or a super_admin as a scoped organizer
-- (a super_admin already has global authority and needs no assignment; a legacy
-- admin must never gain racing authority through an assignment row). Plain
-- SECURITY INVOKER trigger — not a privileged RPC.
create or replace function public.enforce_assigned_user_is_organizer()
returns trigger
language plpgsql
as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.user_profiles where id = new.organizer_id;
  if v_role is distinct from 'organizer' then
    raise exception
      'competition_organizers.organizer_id % must reference a user with role organizer (got %)',
      new.organizer_id, coalesce(v_role::text, 'no such user');
  end if;
  return new;
end;
$$;

create trigger competition_organizers_assignee_is_organizer
before insert or update on public.competition_organizers
for each row execute function public.enforce_assigned_user_is_organizer();

-- RLS on; service_role only (no authenticated/anon grant or policy).
alter table public.competition_organizers enable row level security;
grant select, insert, update, delete on public.competition_organizers to service_role;
