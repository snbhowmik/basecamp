-- ============================================================
-- Derive a batch's name from its years
-- ============================================================
-- The batch form asked for a name ("2024-2028") and then for a start year and
-- an end year, which is the same fact typed twice and two ways for them to
-- disagree. The years are the structured half -- reg_no_matches_batch() and
-- every "which intake is this" query need them -- so the name is what gives.
--
-- p_name is now optional. Passed empty, the name is derived as
-- "<start>-<end>". A name is still accepted for intakes that are genuinely
-- called something else.
create or replace function create_batch(
  p_org_unit_id   uuid,
  p_name          text,
  p_start_year    int,
  p_end_year      int,
  p_mode          text default 'FT',
  p_reg_no_prefix text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_batch uuid; v_unit_code text; v_name text;
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

  v_name := nullif(trim(coalesce(p_name, '')), '');
  if v_name is null then
    v_name := p_start_year || '-' || p_end_year;
  end if;

  insert into batches (org_unit_id, name, start_year, end_year, mode, reg_no_prefix)
  values (
    p_org_unit_id, v_name, p_start_year, p_end_year,
    coalesce(nullif(trim(coalesce(p_mode, '')), ''), 'FT'),
    nullif(upper(trim(coalesce(p_reg_no_prefix, ''))), '')
  )
  returning id into v_batch;

  return v_batch;
end;
$$;
