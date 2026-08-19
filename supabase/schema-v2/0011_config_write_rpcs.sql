-- ============================================================
-- Config edits as functions
-- ============================================================
-- Moving the write path off raw table access: the browser calls a function and
-- the database decides, rather than the browser composing an UPDATE that RLS
-- then has to second-guess. Reads stay as RLS-filtered selects.

create or replace function rename_level(p_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_captain();
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Level name is required.';
  end if;
  update priority_levels set name = trim(p_name) where id = p_id;
end;
$$;

-- Passing an empty code clears the tag, which is a supported state: levels may
-- be named during setup and tagged later.
create or replace function set_level_tag(p_id uuid, p_code text, p_label text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_tag uuid;
begin
  perform assert_captain();
  if exists (select 1 from priority_levels where id = p_id and is_reserved) then
    raise exception 'The captain level keeps its own tag.';
  end if;
  v_tag := upsert_role_tag(p_code, p_label);
  update priority_levels set tag_id = v_tag where id = p_id;
end;
$$;

create or replace function rename_org_unit(p_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_captain();
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Org unit name is required.';
  end if;
  update org_units set name = trim(p_name) where id = p_id;
end;
$$;

create or replace function rename_request_type(p_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_captain();
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Request type name is required.';
  end if;
  update request_types set name = trim(p_name) where id = p_id;
end;
$$;

create or replace function rename_category(p_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_captain();
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Category name is required.';
  end if;
  update request_categories set name = trim(p_name) where id = p_id;
end;
$$;

create or replace function set_category_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform assert_captain();
  update request_categories set is_active = p_active where id = p_id;
end;
$$;

grant execute on function rename_level(uuid, text)          to authenticated;
grant execute on function set_level_tag(uuid, text, text)   to authenticated;
grant execute on function rename_org_unit(uuid, text)       to authenticated;
grant execute on function rename_request_type(uuid, text)   to authenticated;
grant execute on function rename_category(uuid, text)       to authenticated;
grant execute on function set_category_active(uuid, boolean) to authenticated;
