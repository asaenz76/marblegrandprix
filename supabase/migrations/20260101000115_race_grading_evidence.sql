-- Racing fork — Phase 5: competition authoritative winner + racing grading evidence.
--
-- Grading determines WHO WON; the money-moving settlement engine is untouched.

-- Authoritative final winner of a competition. Nullable — set later (Phase 7
-- standings, or a manual finalization); Phase 5 only READS it to grade a
-- COMPETITION_WINNER pool, and treats null as "no authoritative winner yet ->
-- not gradeable". This is a single outcome field, NOT standings logic.
alter table public.racing_competitions
  add column winner_competitor_id uuid references public.competitors (id) on delete restrict;

-- Racing grading evidence — append-only audit of each grading decision,
-- purpose-built for racing (records the source result revision, unlike the
-- football pool_grading_evidence table which this deliberately does not touch).
-- Supports auditability + future correction/reversal (Phase 6/8): the source
-- revision is identifiable, and re-grading the same source is idempotent.
create table public.race_grading_evidence (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null,
  scope text not null check (scope in ('RACE', 'COMPETITION')),
  race_id uuid,
  competition_id uuid,
  result_revision_id uuid,            -- the CONFIRMED race_results revision graded (RACE scope)
  winner_competitor_id uuid not null,
  winning_option_id uuid not null,
  template_id text not null,
  template_version integer not null,
  graded_at timestamptz not null default now()
);

create index race_grading_evidence_pool_idx on public.race_grading_evidence (pool_id);
-- Idempotency backstop for RACE grading: at most one evidence row per pool per
-- source result revision (COMPETITION rows use a null revision and are guarded
-- in application code by a per-pool existence check).
create unique index race_grading_evidence_race_source_idx
  on public.race_grading_evidence (pool_id, result_revision_id)
  where result_revision_id is not null;

-- Append-only: no updates/deletes (same posture as pool_grading_evidence).
create or replace function public.forbid_race_grading_evidence_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'race_grading_evidence is append-only';
end;
$$;
create trigger race_grading_evidence_no_update before update on public.race_grading_evidence
  for each row execute function public.forbid_race_grading_evidence_mutation();
create trigger race_grading_evidence_no_delete before delete on public.race_grading_evidence
  for each row execute function public.forbid_race_grading_evidence_mutation();

-- Same grant posture as pool_grading_evidence: broad authenticated read, writes
-- via service_role only (grading runs through trusted server/system paths). No
-- EXECUTE grants, no new RPC.
alter table public.race_grading_evidence enable row level security;
create policy "members_read_race_grading_evidence" on public.race_grading_evidence
  for select to authenticated using (true);
grant select on public.race_grading_evidence to authenticated;
grant select, insert on public.race_grading_evidence to service_role;
