-- ============================================================
-- Fix two things 0043/0044 got wrong
-- ============================================================
-- 1. admin_delete()'s allowlist. 0026 had grown it to include 'category_stages'
--    and 'stage_tasks' (so the captain can remove a stage or a task). 0043/0044
--    re-issued admin_delete from the older 0014 body and silently dropped those
--    two — a regression. This restores the full 0026 allowlist and keeps the
--    0043/0044 role-removal guards and the 0044 deleted_at skips.
-- 2. delete_own_request() let a requester delete a request in any state. The ask
--    was an ONGOING request. A finished one (approved/rejected/reviewed/closed)
--    carries signatures and a document that still verifies as genuine, so hiding
--    it from the people who signed it is wrong. Restricted to open states.

create or replace function admin_delete(p_table text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_blocked text;
  v_open    int;
  v_strand  int;
  v_allowed text[] := array[
    'priority_levels','org_units','batches','sections','tags','request_types',
    'request_categories','field_definitions','category_first_hop_options',
    'level_checks','role_assignments','pending_assignments','allowed_login_domains',
    'category_stages','stage_tasks'
  ];
begin
  if not (has_tag('admin') and has_mfa()) then
    raise exception 'Only the captain can delete records.';
  end if;

  if p_table = 'role_assignments' then
    select count(*) into v_open
    from requests req
    join role_assignments ra on ra.id = p_id
    where req.current_holder = ra.user_id
      and req.deleted_at is null
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
      and req.deleted_at is null
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

-- Requester delete, now only while the request is still ongoing.
create or replace function delete_own_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r requests%rowtype;
begin
  select * into r from requests where id = p_request_id;
  if not found then raise exception 'No such request.'; end if;
  if r.requested_by <> auth.uid() then
    raise exception 'Only the person who raised a request can delete it.';
  end if;
  if r.deleted_at is not null then return; end if;
  if r.status not in ('draft', 'submitted', 'in_review', 'changes_requested') then
    raise exception 'This request has already been finished, so it can no longer be deleted.';
  end if;

  update requests set deleted_at = now(), current_holder = null where id = p_request_id;

  insert into request_assignment_history (request_id, from_user, to_user, acted_by, action, note)
  values (p_request_id, r.current_holder, null, auth.uid(), 'deleted', null);
end;
$$;
