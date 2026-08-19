-- Free vs Cash stakes on pools.
--
-- FREE pools bypass the wallet ledger entirely: no entry fee, no payouts,
-- no house fee. They exist purely for a separate "free" leaderboard. CASH
-- pools are completely unchanged, and so are the money RPCs
-- (create_pool_entry / confirm_pool_settlement) — FREE pools route to their
-- own no-money RPCs instead. The only core change here is making the
-- entry-fee / entry-amount invariants stakes-aware.

create type public.pool_stakes as enum ('CASH', 'FREE');

alter table public.pools
  add column stakes public.pool_stakes not null default 'CASH';

-- The entry-fee invariant becomes stakes-aware. CASH keeps its positive fee;
-- FREE must be exactly 0 fee and 0 house fee. Replaces `check (entry_fee > 0)`.
alter table public.pools drop constraint pools_entry_fee_check;
alter table public.pools add constraint pools_entry_fee_check
  check (
    (stakes = 'CASH' and entry_fee > 0)
    or (stakes = 'FREE' and entry_fee = 0 and house_fee_bps = 0)
  );

-- FREE entries carry amount 0; CASH entries stay positive (enforced by the
-- pool invariant above + create_pool_entry's amount == entry_fee check).
alter table public.entries drop constraint entries_amount_check;
alter table public.entries add constraint entries_amount_check
  check (amount >= 0);

-- Stakes joins the frozen-after-first-entry set: a pool can't flip
-- free<->cash once entries (and leaderboard/money state) exist.
create or replace function public.enforce_pool_fee_immutability()
returns trigger
language plpgsql
as $$
begin
  if old.first_entry_at is not null then
    if new.entry_fee <> old.entry_fee
      or new.house_fee_bps <> old.house_fee_bps
      or new.question <> old.question
      or new.pool_type <> old.pool_type
      or new.stakes <> old.stakes
    then
      raise exception 'pool fields are frozen after the first entry';
    end if;

    if new.locks_at > old.locks_at then
      raise exception 'lock time may only move earlier after the first entry';
    end if;
  end if;

  return new;
end;
$$;

-- No-money entry for FREE pools. Mirrors create_pool_entry exactly, minus the
-- amount==fee check and the apply_wallet_transaction debit: the entry lands at
-- amount 0 and the wallet is never touched. Same idempotency + one-entry-per-
-- pool semantics as the paid path.
create or replace function public.create_free_pool_entry(
  p_pool_id uuid,
  p_user_id uuid,
  p_option_id uuid,
  p_idempotency_key text
)
returns public.entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.entries;
  v_user public.user_profiles;
  v_pool public.pools;
  v_option public.pool_options;
  v_result public.entries;
begin
  select * into v_existing from public.entries where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_user from public.user_profiles where id = p_user_id;
  if not found or not v_user.is_active then
    raise exception 'user_inactive';
  end if;

  select * into v_pool from public.pools where id = p_pool_id for update;
  if not found then
    raise exception 'pool_not_found';
  end if;
  if v_pool.stakes <> 'FREE' then
    raise exception 'not_a_free_pool';
  end if;
  if v_pool.status <> 'OPEN' then
    raise exception 'pool_not_open';
  end if;
  if now() >= v_pool.locks_at then
    raise exception 'pool_locked';
  end if;

  select * into v_option from public.pool_options where id = p_option_id and pool_id = p_pool_id;
  if not found then
    raise exception 'invalid_option';
  end if;

  begin
    insert into public.entries (pool_id, user_id, option_id, amount, status, idempotency_key)
    values (p_pool_id, p_user_id, p_option_id, 0, 'ACTIVE', p_idempotency_key)
    returning * into v_result;
  exception when unique_violation then
    select * into v_existing from public.entries where idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;

    select * into v_existing from public.entries
      where pool_id = p_pool_id and user_id = p_user_id and status in ('ACTIVE', 'WON', 'LOST');
    return v_existing;
  end;

  update public.pool_options
  set entry_count = entry_count + 1
  where id = p_option_id;

  if v_pool.first_entry_at is null then
    update public.pools set first_entry_at = now() where id = p_pool_id;
  end if;

  return v_result;
end;
$$;

revoke all on function public.create_free_pool_entry(uuid, uuid, uuid, text) from public;
grant execute on function public.create_free_pool_entry(uuid, uuid, uuid, text) to service_role;
