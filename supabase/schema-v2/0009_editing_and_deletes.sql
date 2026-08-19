-- ============================================================
-- Editing, and deletion that cannot strand a reference
-- ============================================================
-- Two problems with what came before.
--
-- The config tables carried a single `for all` write policy, so an admin could
-- DELETE straight through PostgREST. Any guard living in an RPC would simply be
-- bypassed by not calling it. Deletion is therefore removed from the policies
-- entirely and only admin_delete() can perform one -- it is SECURITY DEFINER,
-- so it bypasses RLS on purpose, having first checked what RLS cannot.
--
-- And a delete that strands a reference is not recoverable through the UI. A
-- level still held by a role assignment, an org unit still holding members, a
-- category with tickets filed against it: removing any of those changes what
-- existing records mean. So deletion is refused while anything points at the
-- row, and says exactly what is pointing at it.

-- Fresh TOTP, verified server-side rather than trusted from the client.
-- GoTrue records the authentication methods behind a session in
-- auth.mfa_amr_claims and reflects them in the JWT's `amr` array, each with the
-- timestamp it was satisfied. Re-running the TOTP challenge mints a new token
-- with a fresh timestamp, so "prove it again" is checkable here and not merely
-- a dialog the client could skip.
create or replace function recently_verified_totp(p_max_age_seconds int default 300)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1
    from jsonb_array_elements(
      coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'amr', '[]'::jsonb)
    ) as e
    where e ->> 'method' = 'totp'
      and to_timestamp((e ->> 'timestamp')::bigint) > now() - make_interval(secs => p_max_age_seconds)
  );
$$;

-- Everything currently pointing at a row, discovered from the catalog rather
-- than from a hand-maintained list that would drift as the schema grows.
create or replace function blocking_references(p_table text, p_id uuid)
returns table (ref text, n bigint)
language plpgsql security definer set search_path = public as $$
declare r record; v_count bigint;
begin
  for r in
    select c.conrelid::regclass::text as child_table, a.attname as child_col
    from pg_constraint c
    join unnest(c.conkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.contype = 'f'
      and c.confrelid = p_table::regclass
      and c.connamespace = 'public'::regnamespace
  loop
    execute format('select count(*) from %I where %I = $1', r.child_table, r.child_col)
      into v_count using p_id;
    if v_count > 0 then
      ref := r.child_table || '.' || r.child_col;
      n := v_count;
      return next;
    end if;
  end loop;
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
  if not recently_verified_totp() then
    raise exception 'Confirm with your authenticator before deleting. The code must be entered again for each deletion.';
  end if;
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

  -- Deleting the lowest level would leave the ladder with no base, and
  -- is_lowest_level() resolves through that flag. Move it to whatever is now
  -- lowest, in the same transaction.
  if p_table = 'priority_levels' and not exists (select 1 from priority_levels where is_base) then
    update priority_levels set is_base = true
    where rank = (select max(rank) from priority_levels where not is_reserved);
  end if;
end;
$$;

-- Replace the `for all` write policies with insert + update only. Deletion now
-- has no policy at all, so it is denied to every client and can only happen
-- inside admin_delete().
do $$
declare t text;
begin
  foreach t in array array[
    'priority_levels','tags','user_tags','org_units','batches','sections',
    'allowed_login_domains','cgpa_windows','role_assignments',
    'request_types','request_categories','category_first_hop_options',
    'category_level_roles','level_checks','level_visibility_rules','field_definitions'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format(
      'create policy %I on %I for insert to authenticated '
      'with check (has_tag(''admin'') or can_bootstrap())', t || '_insert', t);
    execute format(
      'create policy %I on %I for update to authenticated '
      'using (has_tag(''admin'') or can_bootstrap()) '
      'with check (has_tag(''admin'') or can_bootstrap())', t || '_update', t);
  end loop;
end
$$;

grant execute on function admin_delete(text, uuid) to authenticated;
grant execute on function recently_verified_totp(int) to authenticated;
revoke execute on function blocking_references(text, uuid) from public;
