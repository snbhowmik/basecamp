-- ============================================================
-- A requester can delete their own request
-- ============================================================
-- Deletion here is the requester withdrawing a request they raised — including
-- one still in flight. It is a soft delete: the row stays so the requester can
-- still see what they withdrew, but it drops out of sight for everyone else and
-- off whatever desk it was sitting on. Only the requester can do it, and only
-- the requester can see a deleted one afterwards.
--
-- A soft delete (deleted_at), not a hard one: a request is referenced by
-- signatures, history and documents, and the requester being able to see their
-- own withdrawn requests is the whole point. Hard-deleting would strand those
-- and show the requester nothing.

alter table requests add column if not exists deleted_at timestamptz;

-- The withdraw action. current_holder is cleared so a deleted request also
-- leaves the desk it was on, not only the lists.
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

  update requests set deleted_at = now(), current_holder = null where id = p_request_id;

  insert into request_assignment_history (request_id, from_user, to_user, acted_by, action, note)
  values (p_request_id, r.current_holder, null, auth.uid(), 'deleted', null);
end;
$$;

-- can_see_request(), re-issued: a deleted request is visible to nobody but the
-- person who raised it. The gate wraps the whole visibility test, so every
-- other reason to see a request (holder, watcher, rank, admin, claimable) is
-- overridden once it is deleted.
create or replace function can_see_request(p_request_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from requests r
    where r.id = p_request_id
      and (r.deleted_at is null or r.requested_by = auth.uid())
      and (
        r.requested_by = auth.uid()
        or r.current_holder = auth.uid()
        or exists (select 1 from request_participants p where p.request_id = r.id and p.member_id = auth.uid())
        or exists (select 1 from request_watchers w where w.request_id = r.id and w.user_id = auth.uid())
        or exists (select 1 from request_assignment_history h where h.request_id = r.id and h.to_user = auth.uid())
        or (
          r.org_unit_id is not null
          and my_rank_in(r.org_unit_id) is not null
          and my_rank_in(r.org_unit_id) < coalesce(
            (select pl.rank from priority_levels pl where pl.id = r.current_level_id), 2147483647
          )
        )
        or exists (
          select 1
          from level_visibility_rules v
          join role_assignments ra on ra.user_id = auth.uid()
            and assignment_is_current(ra.valid_from, ra.valid_until)
          where v.viewer_level_id = ra.level_id
            and v.target_level_id = r.current_level_id
            and v.mode <> 'none'
            and (v.scope = 'any' or (r.org_unit_id is not null and in_org_subtree(ra.org_unit_id, r.org_unit_id)))
        )
        or has_tag('admin')
        or (
          r.current_holder is null
          and r.current_stage_id is not null
          and is_eligible_stage_holder(r.id, r.current_stage_id, auth.uid())
        )
      )
  );
$$;

-- my_claimable_request_ids(), re-issued: a deleted request is never claimable.
-- This runs SECURITY DEFINER (bypassing RLS), so the deleted_at filter has to
-- be stated here rather than relying on can_see_request.
create or replace function my_claimable_request_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select r.id from requests r
  where r.deleted_at is null
    and r.current_holder is null
    and r.current_stage_id is not null
    and r.status = 'in_review'
    and is_eligible_stage_holder(r.id, r.current_stage_id, auth.uid());
$$;

-- admin_delete(), re-issued: the role-removal guards must not count a deleted
-- (withdrawn) request as a live ticket on someone's desk, or as a claimable one
-- that would be stranded. Same guards as 0043, now skipping deleted requests.
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

grant execute on function delete_own_request(uuid) to authenticated;
