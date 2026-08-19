-- ============================================================
-- The captain rung is not invitable
-- ============================================================
-- can_invite() read "has_tag('admin') or outranks the target level", so the
-- captain satisfied it for every level including their own reserved one. An
-- invite issued at that level would have made the invitee a second captain on
-- signup, via apply_pending_assignment(), with no further check anywhere.
--
-- Fixed in can_invite() itself rather than only in create_invite(), so every
-- present and future caller inherits it.
create or replace function can_invite(p_level_id uuid, p_org_unit_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    not coalesce((select is_reserved from priority_levels where id = p_level_id), true)
    and (
      has_tag('admin')
      or (
        p_org_unit_id is not null
        and my_rank_in(p_org_unit_id) is not null
        and my_rank_in(p_org_unit_id) < (select rank from priority_levels where id = p_level_id)
      )
    );
$$;

-- Said again here so the refusal is a sentence rather than the generic
-- "you cannot invite someone at that level" that every other denial produces.
create or replace function create_invite(
  p_email       text,
  p_level_id    uuid,
  p_tag_codes   text[],
  p_member_type text,
  p_role_kind   text,
  p_org_unit_id uuid default null,
  p_batch_id    uuid default null,
  p_section_id  uuid default null,
  p_reg_no      text default null,
  p_fet_id      text default null
)
returns pending_assignments language plpgsql security definer set search_path = public as $$
declare v_row pending_assignments;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if exists (select 1 from priority_levels where id = p_level_id and is_reserved) then
    raise exception 'The captain level cannot be invited to. It belongs to the account that set the instance up.';
  end if;
  if not can_invite(p_level_id, p_org_unit_id) then
    raise exception 'You cannot invite someone at that level in that part of the organisation.';
  end if;
  if 'admin' = any(coalesce(p_tag_codes, array[]::text[])) then
    raise exception 'The captain tag cannot be granted through an invite.';
  end if;

  insert into pending_assignments (
    email, level_id, tag_codes, member_type, role_kind,
    org_unit_id, batch_id, section_id, reg_no, fet_id, invited_by
  ) values (
    lower(trim(p_email)), p_level_id, coalesce(p_tag_codes, array[]::text[]),
    p_member_type, coalesce(p_role_kind, 'academic'),
    p_org_unit_id, p_batch_id, p_section_id,
    nullif(trim(coalesce(p_reg_no, '')), ''), nullif(trim(coalesce(p_fet_id, '')), ''),
    auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;
