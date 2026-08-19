-- ============================================================
-- People administration
-- ============================================================
-- Changing someone's level, scope or tags is not the same kind of edit as
-- renaming a category: it grants or revokes authority over other people's
-- tickets. All of it goes through functions rather than table writes, so the
-- rules live in one place and the browser cannot compose its own version.

-- Grant a role assignment. A person can hold several -- an academic mentor who
-- also coordinates a club is two assignments, not one edited in place (D-1).
create or replace function assign_role(
  p_user_id     uuid,
  p_level_id    uuid,
  p_org_unit_id uuid    default null,
  p_section_id  uuid    default null,
  p_role_kind   text    default 'academic',
  p_is_primary  boolean default false
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (has_tag('admin') and has_mfa()) then
    raise exception 'Only the captain can assign roles.';
  end if;
  if not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'Unknown account.';
  end if;
  if exists (select 1 from priority_levels where id = p_level_id and is_reserved) then
    raise exception 'The captain level cannot be assigned. It belongs to the account that set the instance up.';
  end if;
  if not exists (select 1 from priority_levels where id = p_level_id and is_active) then
    raise exception 'Unknown or inactive level.';
  end if;

  -- One primary per person: the assignment their dashboard defaults to.
  if p_is_primary then
    update role_assignments set is_primary = false where user_id = p_user_id;
  end if;

  insert into role_assignments (user_id, level_id, org_unit_id, section_id, role_kind, is_primary, assigned_by)
  values (p_user_id, p_level_id, p_org_unit_id, p_section_id, coalesce(p_role_kind, 'academic'), p_is_primary, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- Replace someone's role tags with exactly this set.
--
-- 'admin' is untouchable here, in both directions. Granting it would mint a
-- second captain through a dropdown; revoking it -- including from yourself --
-- could leave the instance with nobody able to administer it, and
-- is_bootstrapping() would flip back to true, reopening the setup window.
create or replace function set_user_tags(p_user_id uuid, p_codes text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (has_tag('admin') and has_mfa()) then
    raise exception 'Only the captain can change tags.';
  end if;
  if not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'Unknown account.';
  end if;
  if 'admin' = any(coalesce(p_codes, array[]::text[])) then
    raise exception 'The captain tag cannot be granted here.';
  end if;

  delete from user_tags ut
  using tags t
  where ut.tag_id = t.id
    and ut.user_id = p_user_id
    and t.code <> 'admin'
    and not (t.code = any(coalesce(p_codes, array[]::text[])));

  insert into user_tags (user_id, tag_id, granted_by)
  select p_user_id, t.id, auth.uid()
  from tags t
  where t.code = any(coalesce(p_codes, array[]::text[]))
  on conflict do nothing;
end;
$$;

-- Where a person sits in the org. Kept separate from their authority: moving
-- someone between programmes is a different act from changing their rank.
create or replace function update_member_profile(
  p_user_id     uuid,
  p_org_unit_id uuid default null,
  p_batch_id    uuid default null,
  p_section_id  uuid default null,
  p_reg_no      text default null,
  p_fet_id      text default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (has_tag('admin') and has_mfa()) then
    raise exception 'Only the captain can change member details.';
  end if;
  if not exists (select 1 from member_profiles where user_id = p_user_id) then
    raise exception 'That account has no member profile.';
  end if;

  update member_profiles
  set org_unit_id = p_org_unit_id,
      batch_id    = p_batch_id,
      section_id  = p_section_id,
      reg_no      = nullif(trim(coalesce(p_reg_no, '')), ''),
      fet_id      = nullif(trim(coalesce(p_fet_id, '')), '')
  where user_id = p_user_id;
end;
$$;

-- Suspend or restore an account. Deliberately not a delete: the person's
-- tickets, signatures and history stay meaningful, and profiles is referenced
-- from too many places for removal to ever be the right verb here.
create or replace function set_account_active(p_user_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (has_tag('admin') and has_mfa()) then
    raise exception 'Only the captain can suspend accounts.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot suspend your own account.';
  end if;
  if not p_active and not recently_verified_totp() then
    raise exception 'Confirm with your authenticator before suspending an account.';
  end if;

  update profiles set is_active = p_active where id = p_user_id;
end;
$$;

grant execute on function assign_role(uuid, uuid, uuid, uuid, text, boolean) to authenticated;
grant execute on function set_user_tags(uuid, text[]) to authenticated;
grant execute on function update_member_profile(uuid, uuid, uuid, uuid, text, text) to authenticated;
grant execute on function set_account_active(uuid, boolean) to authenticated;
