-- ============================================================
-- Priority level setup, append, and mid-ladder insert
-- ============================================================
-- Levels are built once, from the dashboard, by the captain. Doing it as a
-- sequence of client-side inserts is not safe: granting the admin tag closes
-- the bootstrap window, so a failure part-way through can leave a half-built
-- ladder that the captain no longer has the authority to finish. These RPCs
-- each run as a single transaction instead.
--
-- Ranks are allocated sparsely (10, 20, 30 ...). The gaps are the whole point:
-- inserting a level between two existing ones must never renumber the levels
-- around it, because tickets in flight reference a level and resolve authority
-- through its rank.

-- Reserved rung for the captain, always the top of the ladder.
create or replace function reserved_captain_rank() returns int
language sql immutable as $$ select 10 $$;

-- First run. Creates the captain's reserved rung, then the ladder the captain
-- typed, then claims captaincy.
--
-- The captain is NOT asked to type their own level. Requiring it means it can
-- be forgotten, misspelled, or ordered wrongly, and the top of the ladder is
-- not a thing that should depend on that. It is created here, above whatever
-- the captain called their highest rung.
--
-- Authorization is can_bootstrap(), re-checked here rather than trusted from
-- the client: SECURITY DEFINER bypasses RLS, so the policy that would have
-- guarded these tables does not apply inside this body.
create or replace function setup_levels(p_levels jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_item  jsonb;
  v_n     int := 0;
  v_total int := jsonb_array_length(p_levels);
  v_tag   uuid;
  v_admin uuid;
  v_top   uuid;
  v_code  text;
begin
  if not can_bootstrap() then
    raise exception 'Levels can only be set up by the first account, before setup completes.';
  end if;
  if v_total is null or v_total = 0 then
    raise exception 'At least one level is required.';
  end if;

  insert into tags (code, label, tag_type) values ('admin', 'Captain', 'role')
  on conflict (code) do update set label = excluded.label
  returning id into v_admin;

  insert into priority_levels (rank, name, is_base, is_reserved, tag_id)
  values (reserved_captain_rank(), 'Captain', false, true, v_admin)
  returning id into v_top;

  for v_item in select * from jsonb_array_elements(p_levels) loop
    v_n := v_n + 1;
    v_tag := null;
    v_code := lower(trim(coalesce(v_item ->> 'tag_code', '')));

    if v_code = 'admin' then
      raise exception 'The tag "admin" is reserved for the captain.';
    end if;

    if v_code <> '' then
      insert into tags (code, label, tag_type)
      values (v_code, coalesce(nullif(trim(v_item ->> 'tag_label'), ''), v_code), 'role')
      on conflict (code) do update set label = excluded.label
      returning id into v_tag;
    end if;

    insert into priority_levels (rank, name, is_base, tag_id)
    values (reserved_captain_rank() + (v_n * 10), trim(v_item ->> 'name'), v_n = v_total, v_tag);
  end loop;

  -- Order is load-bearing: the assignment must land before the tag, because
  -- the tag is what revokes can_bootstrap() authority from this very session.
  insert into role_assignments (user_id, level_id, role_kind, is_primary)
  values (v_uid, v_top, 'admin', true);

  insert into user_tags (user_id, tag_id, granted_by) values (v_uid, v_admin, v_uid);
end;
$$;

-- Shared guard + tag upsert for the two post-setup operations.
create or replace function assert_captain() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (has_tag('admin') and has_mfa()) then
    raise exception 'Only the captain can change levels.';
  end if;
end;
$$;

create or replace function upsert_role_tag(p_code text, p_label text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text := lower(trim(coalesce(p_code, '')));
begin
  if v_code = '' then return null; end if;
  if v_code = 'admin' then
    raise exception 'The tag "admin" is reserved for the captain.';
  end if;
  insert into tags (code, label, tag_type)
  values (v_code, coalesce(nullif(trim(p_label), ''), v_code), 'role')
  on conflict (code) do update set label = excluded.label
  returning id into v_id;
  return v_id;
end;
$$;

-- Append at the bottom. The new level becomes the base, and is_base moves with
-- it in the same transaction so the "exactly one base level" invariant never
-- breaks. v1 derived the base from max(rank) and broke silently here
-- (SECURITY.md R-27).
create or replace function append_level(
  p_name text, p_tag_code text default null, p_tag_label text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_rank int; v_tag uuid; v_id uuid;
begin
  perform assert_captain();
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Level name is required.';
  end if;

  select coalesce(max(rank), reserved_captain_rank()) + 10 into v_rank from priority_levels;
  v_tag := upsert_role_tag(p_tag_code, p_tag_label);

  update priority_levels set is_base = false where is_base;

  insert into priority_levels (rank, name, is_base, tag_id)
  values (v_rank, trim(p_name), true, v_tag)
  returning id into v_id;

  return v_id;
end;
$$;

-- Insert between two existing levels, taking the midpoint of the gap. This is
-- what the sparse allocation buys: no existing level moves, so no in-flight
-- ticket changes meaning. If a gap is ever exhausted the caller is told
-- plainly rather than being silently renumbered underneath.
create or replace function insert_level_after(
  p_after_level_id uuid, p_name text,
  p_tag_code text default null, p_tag_label text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_after int; v_next int; v_rank int; v_tag uuid; v_id uuid;
begin
  perform assert_captain();
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Level name is required.';
  end if;

  select rank into v_after from priority_levels where id = p_after_level_id;
  if v_after is null then
    raise exception 'Unknown level.';
  end if;

  select min(rank) into v_next from priority_levels where rank > v_after;
  if v_next is null then
    raise exception 'That is the lowest level -- use append_level() instead.';
  end if;
  if v_next - v_after < 2 then
    raise exception 'No rank gap between those levels. Renumbering is required, which would move levels that existing tickets reference.';
  end if;

  v_rank := v_after + ((v_next - v_after) / 2);
  v_tag  := upsert_role_tag(p_tag_code, p_tag_label);

  insert into priority_levels (rank, name, is_base, tag_id)
  values (v_rank, trim(p_name), false, v_tag)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function assert_captain() from public;
revoke execute on function upsert_role_tag(text, text) from public;
grant execute on function setup_levels(jsonb) to authenticated;
grant execute on function append_level(text, text, text) to authenticated;
grant execute on function insert_level_after(uuid, text, text, text) to authenticated;
