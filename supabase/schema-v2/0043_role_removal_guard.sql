-- ============================================================
-- Don't remove a mentor who still has tickets on their desk
-- ============================================================
-- admin_delete() refused a role_assignment only if a foreign key still pointed
-- at the row (requested_as / acted_as). But current_holder references the
-- person, not the assignment, so a mentor could be stripped of the very role
-- they are holding live tickets under, and those tickets would be left on a
-- desk whose authority had just been taken away.
--
-- Two new refusals, specific to role_assignments, run right after the captain
-- check and before the TOTP step so the captain learns *why* without first
-- fishing out a fresh code:
--
--   1. The person is the current holder of open tickets ON THIS ROLE (same
--      level and scope). Scoped to the role so losing a club role is not
--      blocked by unrelated OD tickets.
--   2. Removing this role would leave an unclaimed ticket at a stage this role
--      serves with nobody left able to claim it — the exact hole the new
--      claimable-stage behaviour (0042) would otherwise open.
--
-- Transferring those tickets to a replacement is a later feature; for now the
-- captain resolves or reassigns them first, and the message says so.

create or replace function admin_delete(p_table text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_blocked text;
  v_open    int;
  v_strand  int;
  v_allowed text[] := array[
    'priority_levels','org_units','batches','sections','tags','request_types',
    'request_categories','field_definitions','category_first_hop_options',
    'level_checks','role_assignments','pending_assignments','allowed_login_domains'
  ];
begin
  if not (has_tag('admin') and has_mfa()) then
    raise exception 'Only the captain can delete records.';
  end if;

  -- Role-removal guards, before the TOTP step so the reason is seen first.
  if p_table = 'role_assignments' then
    select count(*) into v_open
    from requests req
    join role_assignments ra on ra.id = p_id
    where req.current_holder = ra.user_id
      and req.status in ('submitted', 'in_review', 'changes_requested')
      and req.current_level_id = ra.level_id
      and (ra.org_unit_id is null or req.org_unit_id is null
           or in_org_subtree(ra.org_unit_id, req.org_unit_id));
    if v_open > 0 then
      raise exception
        'Can''t remove this role yet — % unresolved ticket(s) are still on this person''s desk. Resolve or reassign them first (ticket transfer is coming in a later version).', v_open;
    end if;

    select count(*) into v_strand
    from requests req
    join role_assignments ra on ra.id = p_id
    join category_stages cs on cs.id = req.current_stage_id and cs.level_id = ra.level_id
    where req.current_holder is null
      and req.status = 'in_review'
      and is_eligible_stage_holder(req.id, req.current_stage_id, ra.user_id)
      and not exists (
        select 1 from role_assignments r2
        where r2.id <> p_id
          and r2.level_id = cs.level_id
          and assignment_is_current(r2.valid_from, r2.valid_until)
          and r2.user_id <> req.requested_by
          and (r2.org_unit_id is null or req.org_unit_id is null
               or in_org_subtree(r2.org_unit_id, req.org_unit_id))
      );
    if v_strand > 0 then
      raise exception
        'Can''t remove this role yet — % request(s) are waiting to be claimed at this stage and this is the last person who can act on them. Add another holder or clear those first.', v_strand;
    end if;
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
