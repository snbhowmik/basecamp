-- ============================================================
-- Org-tree creation RPCs
-- ============================================================
-- v1 had create_department()/create_batch(); the v2 baseline replaced
-- departments+classes with org_units+batches+sections but never carried the
-- RPCs across, so app/src/lib/org.ts had nothing to call.
--
-- These stay SECURITY DEFINER RPCs rather than client-side inserts for the
-- same reason v1 did: each row also needs its scope tag, and two round trips
-- from the browser leave an orphan tag behind whenever the second one fails.
--
-- The wizard does NOT use these — it runs during the bootstrap window, writes
-- org_units directly under can_bootstrap(), and the captain holds no admin tag
-- yet at that point. These are for org administration after setup.

create or replace function create_org_unit(
  p_name      text,
  p_code      text,
  p_unit_type text,
  p_parent_id uuid default null,
  p_campus    text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tag uuid; v_unit uuid; v_code text;
begin
  if not (has_tag('admin') and has_mfa()) then
    raise exception 'Only the captain can create org units.';
  end if;
  if p_unit_type not in ('faculty', 'programme') then
    raise exception 'unit_type must be faculty or programme.';
  end if;

  v_code := lower(trim(p_code));
  if v_code = '' then
    raise exception 'Org unit code is required.';
  end if;

  insert into tags (code, label, tag_type)
  values ('org:' || v_code, initcap(p_unit_type) || ': ' || trim(p_name), 'scope')
  on conflict (code) do update set label = excluded.label
  returning id into v_tag;

  insert into org_units (name, code, unit_type, parent_id, campus, tag_id)
  values (trim(p_name), v_code, p_unit_type, p_parent_id, nullif(trim(coalesce(p_campus, '')), ''), v_tag)
  returning id into v_unit;

  return v_unit;
end;
$$;

create or replace function create_batch(
  p_org_unit_id   uuid,
  p_name          text,
  p_start_year    int,
  p_end_year      int,
  p_mode          text default 'FT',
  p_reg_no_prefix text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_batch uuid; v_unit_code text;
begin
  if not (has_tag('admin') and has_mfa()) then
    raise exception 'Only the captain can create batches.';
  end if;

  select code into v_unit_code from org_units where id = p_org_unit_id;
  if v_unit_code is null then
    raise exception 'Unknown org unit.';
  end if;
  if p_end_year <= p_start_year then
    raise exception 'Batch end year must be after its start year.';
  end if;

  -- No scope tag here: batches are addressed through their org unit and their
  -- sections, and an unused tag per batch is just clutter. sections carry
  -- their own tag_id because mentor scoping resolves through them.
  insert into batches (org_unit_id, name, start_year, end_year, mode, reg_no_prefix)
  values (
    p_org_unit_id, trim(p_name), p_start_year, p_end_year,
    coalesce(nullif(trim(coalesce(p_mode, '')), ''), 'FT'),
    nullif(upper(trim(coalesce(p_reg_no_prefix, ''))), '')
  )
  returning id into v_batch;

  return v_batch;
end;
$$;

grant execute on function create_org_unit(text, text, text, uuid, text) to authenticated;
grant execute on function create_batch(uuid, text, int, int, text, text) to authenticated;
