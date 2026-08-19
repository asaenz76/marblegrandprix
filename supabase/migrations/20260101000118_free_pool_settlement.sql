-- Free-pool settlement + stakes-scoped leaderboard.
--
-- FREE pools never touch the wallet: settle_free_pool grades outcomes and
-- writes the leaderboard log, but moves no money and calls no money RPC.
-- get_leaderboard gains an optional stakes scope so the app can show separate
-- Free / Cash boards. The money RPCs (confirm_pool_settlement, etc.) are
-- untouched.

-- Free wins have no settlement row, so the leaderboard log's settlement_id
-- must be nullable. Cash wins still populate it (and reversal still keys off
-- it); free wins carry null.
alter table public.correct_prediction_log
  alter column settlement_id drop not null;

-- No-money settlement for FREE pools. Marks WON/LOST from the graded winning
-- option and records a leaderboard credit per winner — no wallet transaction,
-- no house fee, no payout, and (deliberately) no bump to the cash-oriented
-- flat correct_predictions_count / streak counters. Idempotent: a second call
-- on an already-SETTLED pool is a no-op.
create or replace function public.settle_free_pool(
  p_pool_id uuid,
  p_winning_option_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool public.pools;
  v_entry public.entries;
begin
  select * into v_pool from public.pools where id = p_pool_id for update;
  if not found then
    raise exception 'pool_not_found';
  end if;
  if v_pool.stakes <> 'FREE' then
    raise exception 'not_a_free_pool';
  end if;
  if v_pool.status = 'SETTLED' then
    return;
  end if;

  update public.entries set status = 'WON'
    where pool_id = p_pool_id and status = 'ACTIVE' and option_id = p_winning_option_id;
  update public.entries set status = 'LOST'
    where pool_id = p_pool_id and status = 'ACTIVE' and option_id <> p_winning_option_id;

  update public.pool_options set is_winning_option = true where id = p_winning_option_id;

  for v_entry in
    select * from public.entries where pool_id = p_pool_id and status = 'WON'
  loop
    insert into public.correct_prediction_log (user_id, pool_id, settlement_id)
    values (v_entry.user_id, p_pool_id, null);
  end loop;

  update public.pools set status = 'SETTLED' where id = p_pool_id;
end;
$$;

revoke all on function public.settle_free_pool(uuid, uuid) from public;
grant execute on function public.settle_free_pool(uuid, uuid) to service_role;

-- Leaderboard with an optional stakes scope. p_stakes null keeps the exact
-- prior behaviour (all-time reads the flat counter; the extra pools join is a
-- no-op because every log/entry row has a pool). p_stakes 'CASH'/'FREE'
-- aggregates the log/entries joined to pools filtered by that stakes type, for
-- every range — the two separate leaderboards.
drop function if exists public.get_leaderboard(text, text, uuid);

create or replace function public.get_leaderboard(
  p_scope text, p_range text, p_caller_id uuid, p_stakes text default null
)
returns table (
  user_id uuid, display_name text, username text, avatar_url text,
  correct_count bigint, total_count bigint, rank bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_window_start timestamptz;
begin
  v_window_start := case p_range
    when 'weekly' then date_trunc('week', now())
    when 'monthly' then date_trunc('month', now())
    else '-infinity'::timestamptz
  end;

  return query
    with picks as (
      select
        up.id as pick_user_id,
        up.display_name as pick_display_name,
        up.username as pick_username,
        up.avatar_url as pick_avatar_url,
        case
          when p_stakes is null and p_range = 'all_time' then up.correct_predictions_count
          else (
            select count(*)::bigint
            from public.correct_prediction_log cpl
            join public.pools pl on pl.id = cpl.pool_id
            where cpl.user_id = up.id
              and (p_range = 'all_time' or cpl.created_at >= v_window_start)
              and (p_stakes is null or pl.stakes = p_stakes::public.pool_stakes)
          )
        end as pick_correct_count,
        (
          select count(*)::bigint
          from public.entries e
          join public.pools pl2 on pl2.id = e.pool_id
          where e.user_id = up.id
            and e.status in ('WON', 'LOST')
            and (p_range = 'all_time' or e.updated_at >= v_window_start)
            and (p_stakes is null or pl2.stakes = p_stakes::public.pool_stakes)
        ) as pick_total_count
      from public.user_profiles up
      where up.is_active = true
        and up.role = 'player'
        and (
          p_scope = 'global'
          or up.id = p_caller_id
          or up.id in (select f.followee_id from public.follows f where f.follower_id = p_caller_id)
        )
    )
    select
      picks.pick_user_id,
      picks.pick_display_name,
      picks.pick_username,
      picks.pick_avatar_url,
      picks.pick_correct_count,
      picks.pick_total_count,
      rank() over (
        order by
          case when picks.pick_total_count > 0
            then picks.pick_correct_count::numeric / picks.pick_total_count
            else 0
          end desc,
          picks.pick_correct_count desc,
          picks.pick_total_count desc
      )
    from picks
    order by
      case when picks.pick_total_count > 0
        then picks.pick_correct_count::numeric / picks.pick_total_count
        else 0
      end desc,
      picks.pick_correct_count desc,
      picks.pick_total_count desc,
      picks.pick_display_name asc
    limit 100;
end;
$$;

revoke all on function public.get_leaderboard(text, text, uuid, text) from public;
grant execute on function public.get_leaderboard(text, text, uuid, text) to authenticated, service_role;
