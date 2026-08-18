-- ============================================================
-- Priority level setup and append
-- ============================================================
-- Levels are built once, from the dashboard, by the captain. Doing it as a
-- sequence of client-side inserts is not safe: granting the admin tag closes
-- the bootstrap window, so a failure part-way through can leave a half-built
-- ladder that the captain no longer has the authority to finish. Both RPCs
-- run as a single transaction instead.

-- First run. Creates the whole ladder, gives the captain the top level, and
-- grants the admin tag last -- the write that flips is_bootstrapping() false.
--
-- Authorization is can_bootstrap(), re-checked here rather than trusted from
-- the client: SECURITY DEFINER bypasses RLS, so the policy that would have
-- guarded these tables does not apply inside this body.
create or replace function setup_levels(p_levels jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_item  jsonb;
  v_rank  int := 0;
  v_total int := jsonb_array_length(p_levels);
  v_tag   uuid;
  v_top   uuid;
  v_code  text;
begin
  if not can_bootstrap() then
    raise exception 'Levels can only be set up by the first account, before setup completes.';
  end if;
  if v_total is null or v_total = 0 then
    raise exception 'At least one level is required.';
  end if;

  for v_item in select * from jsonb_array_elements(p_levels) loop
    v_rank := v_rank + 1;
    v_tag  := null;
    v_code := lower(trim(coalesce(v_item ->> 'tag_code', '')));

    if v_code <> '' then
      insert into tags (code, label, tag_type)
      values (v_code, coalesce(nullif(trim(v_item ->> 'tag_label'), ''), v_code), 'role')
      on conflict (code) do update set label = excluded.label
      returning id into v_tag;
    end if;

    insert into priority_levels (rank, name, is_base, tag_id)
    values (v_rank, trim(v_item ->> 'name'), v_rank = v_total, v_tag);
  end loop;

  select id into v_top from priority_levels where rank = 1;

  -- Order is load-bearing: the assignment must land before the tag, because
  -- the tag is what revokes can_bootstrap() authority from this very session.
  insert into role_assignments (user_id, level_id, role_kind, is_primary)
  values (v_uid, v_top, 'admin', true);

  insert into tags (code, label, tag_type) values ('admin', 'Captain', 'role')
  on conflict (code) do update set label = excluded.label
  returning id into v_tag;

  insert into user_tags (user_id, tag_id, granted_by) values (v_uid, v_tag, v_uid);
end;
$$;

-- Append-only addition after setup. A new level goes to the bottom of the
-- ladder, which makes it the new base -- is_base moves with it in the same
-- transaction so the "exactly one base level" invariant never breaks. v1
-- derived the base from max(rank) and broke silently here (SECURITY.md R-27).
create or replace function append_level(
  p_name text, p_tag_code text default null, p_tag_label text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_rank int;
  v_tag  uuid;
  v_id   uuid;
  v_code text := lower(trim(coalesce(p_tag_code, '')));
begin
  if not (has_tag('admin') and has_mfa()) then
    raise exception 'Only the captain can add levels.';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Level name is required.';
  end if;

  select coalesce(max(rank), 0) + 1 into v_rank from priority_levels;

  if v_code <> '' then
    insert into tags (code, label, tag_type)
    values (v_code, coalesce(nullif(trim(p_tag_label), ''), v_code), 'role')
    on conflict (code) do update set label = excluded.label
    returning id into v_tag;
  end if;

  update priority_levels set is_base = false where is_base;

  insert into priority_levels (rank, name, is_base, tag_id)
  values (v_rank, trim(p_name), true, v_tag)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function setup_levels(jsonb) to authenticated;
grant execute on function append_level(text, text, text) to authenticated;
