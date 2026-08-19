-- ============================================================
-- Editing a batch
-- ============================================================
-- Batches were creatable and deletable but not editable, so a mistyped
-- register-number prefix could only be corrected by deleting the batch and
-- rebuilding it -- which is impossible once students are attached to it, and
-- which the reg-no prefix is exactly the kind of field to get wrong on the
-- first attempt.
--
-- org_unit_id is deliberately not editable. Moving a batch between programmes
-- would change what its existing members' register numbers are validated
-- against, and silently invalidate them.
create or replace function update_batch(
  p_id            uuid,
  p_name          text default null,
  p_start_year    int  default null,
  p_end_year      int  default null,
  p_mode          text default null,
  p_reg_no_prefix text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare b batches%rowtype; v_start int; v_end int;
begin
  perform assert_captain();

  select * into b from batches where id = p_id;
  if not found then
    raise exception 'Unknown batch.';
  end if;

  v_start := coalesce(p_start_year, b.start_year);
  v_end   := coalesce(p_end_year,   b.end_year);
  if v_end <= v_start then
    raise exception 'Batch end year must be after its start year.';
  end if;

  update batches
  set start_year    = v_start,
      end_year      = v_end,
      -- An empty name re-derives it, matching how create_batch() behaves.
      name          = coalesce(nullif(trim(coalesce(p_name, '')), ''), v_start || '-' || v_end),
      mode          = coalesce(nullif(trim(coalesce(p_mode, '')), ''), b.mode),
      -- Empty clears the prefix, which means "accept any register number" --
      -- a real choice for an intake whose numbering is not yet settled.
      reg_no_prefix = nullif(upper(trim(coalesce(p_reg_no_prefix, ''))), '')
  where id = p_id;
end;
$$;

grant execute on function update_batch(uuid, text, int, int, text, text) to authenticated;
