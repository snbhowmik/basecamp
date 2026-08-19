-- ============================================================
-- Say which TOTP problem it is
-- ============================================================
-- "Confirm with your authenticator" covered two situations needing different
-- responses: the session carries no authenticator record at all (nothing to
-- check against -- sign out and back in), or it does and the code is simply
-- older than the window. Reporting them identically made a failed deletion
-- impossible to act on.
create or replace function totp_freshness(p_max_age_seconds int default 300)
returns text language sql stable set search_path = public as $$
  with claims as (
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) as j
  ),
  totp as (
    select max((e ->> 'timestamp')::bigint) as ts
    from claims, jsonb_array_elements(coalesce(claims.j -> 'amr', '[]'::jsonb)) as e
    where e ->> 'method' = 'totp'
  )
  select case
    when (select ts from totp) is null then 'absent'
    when to_timestamp((select ts from totp)) > now() - make_interval(secs => p_max_age_seconds) then 'fresh'
    else 'stale'
  end;
$$;

create or replace function recently_verified_totp(p_max_age_seconds int default 300)
returns boolean language sql stable set search_path = public as $$
  select totp_freshness(p_max_age_seconds) = 'fresh';
$$;

create or replace function assert_fresh_totp() returns void
language plpgsql security definer set search_path = public as $$
declare v text := totp_freshness();
begin
  if v = 'fresh' then return; end if;
  if v = 'absent' then
    raise exception 'This session carries no authenticator record, so the code could not be checked. Sign out, sign in again with your authenticator, then retry.';
  end if;
  raise exception 'That authenticator code has expired. Enter a fresh one and retry.';
end;
$$;

create or replace function admin_delete(p_table text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_blocked text;
  v_allowed text[] := array[
    'priority_levels','org_units','batches','sections','tags','request_types',
    'request_categories','field_definitions','category_first_hop_options',
    'level_checks','role_assignments','pending_assignments','allowed_login_domains'
  ];
begin
  if not (has_tag('admin') and has_mfa()) then
    raise exception 'Only the captain can delete records.';
  end if;
  perform assert_fresh_totp();
  if not (p_table = any(v_allowed)) then
    raise exception 'Records of type "%" cannot be deleted here.', p_table;
  end if;

  if p_table = 'priority_levels'
     and exists (select 1 from priority_levels where id = p_id and is_reserved) then
    raise exception 'The captain level is part of the ladder and cannot be removed.';
  end if;

  select string_agg(ref || ' (' || n || ')', ', ' order by ref)
    into v_blocked from blocking_references(p_table, p_id);
  if v_blocked is not null then
    raise exception 'Still in use by: %. Remove or reassign those first.', v_blocked;
  end if;

  execute format('delete from %I where id = $1', p_table) using p_id;

  if p_table = 'priority_levels' and not exists (select 1 from priority_levels where is_base) then
    update priority_levels set is_base = true
    where rank = (select max(rank) from priority_levels where not is_reserved);
  end if;
end;
$$;

grant execute on function totp_freshness(int) to authenticated;
revoke execute on function assert_fresh_totp() from public;
