-- ============================================================
-- Claimable approval stages — more than one holder, first to claim it owns it
-- ============================================================
-- Until now an approval stage resolved to exactly one holder: resolve_stage_
-- holder() ordered the eligible people and took LIMIT 1, "so the same person
-- is picked every time". That is right when a stage has one holder, and wrong
-- the moment a class has two mentors — the second one, added later, could
-- never be the holder and so never saw the request at all.
--
-- The rule now: a stage with ONE eligible holder still auto-assigns to them
-- (no change for an HOD stage, a dean stage, anything with a single owner). A
-- stage with TWO OR MORE equally-ranked holders lands UNCLAIMED — current_
-- holder is null — and every one of those holders can see it and claim it.
-- Whoever claims it first becomes the holder and acts as before; the claim is
-- a single atomic update so two people pressing it at once cannot both win.
--
-- "Equally-ranked" is the top tier of the existing ordering (is_primary, then
-- scoped-over-instance-wide). A scoped mentor and an instance-wide one are not
-- a tie — the scoped one still auto-wins — so this only opens up when the
-- holders are genuinely interchangeable for this request.

-- Does this specific person hold the role this stage is waiting on, for this
-- request's scope? Mirrors resolve_stage_holder()'s predicate exactly (level,
-- currency, scope, not-the-requester), written once and reused by the
-- visibility arm, the claim RPC, the notification feed and the delete guard.
-- SECURITY DEFINER because my_notifications() runs as the caller and still has
-- to read role_assignments to answer this.
create or replace function is_eligible_stage_holder(
  p_request_id uuid, p_stage_id uuid, p_user_id uuid
) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from category_stages cs
    join requests r on r.id = p_request_id
    join role_assignments ra on ra.level_id = cs.level_id
      and assignment_is_current(ra.valid_from, ra.valid_until)
    where cs.id = p_stage_id
      and ra.user_id = p_user_id
      and ra.user_id <> r.requested_by
      and (ra.org_unit_id is null or r.org_unit_id is null
           or in_org_subtree(ra.org_unit_id, r.org_unit_id))
  );
$$;

-- How many people sit in the TOP tier of eligibility for this stage — the
-- group resolve_stage_holder() would have had to break a tie within. One means
-- auto-assign; more than one means claimable. Distinct on user_id so a person
-- holding two assignments at the same level is still one holder.
create or replace function top_tier_holder_count(
  p_request_id uuid, p_stage_id uuid
) returns int language sql stable security definer set search_path = public as $$
  with e as (
    select distinct on (ra.user_id)
      ra.user_id, ra.is_primary, (ra.org_unit_id is not null) as scoped
    from category_stages cs
    join requests r on r.id = p_request_id
    join role_assignments ra on ra.level_id = cs.level_id
      and assignment_is_current(ra.valid_from, ra.valid_until)
    where cs.id = p_stage_id
      and ra.user_id <> r.requested_by
      and (ra.org_unit_id is null or r.org_unit_id is null
           or in_org_subtree(ra.org_unit_id, r.org_unit_id))
    order by ra.user_id, ra.is_primary desc, scoped desc
  ),
  top as (select is_primary, scoped from e order by is_primary desc, scoped desc limit 1)
  select coalesce(
    (select count(*)::int from e join top on e.is_primary = top.is_primary and e.scoped = top.scoped),
    0);
$$;

-- advance_stage(), re-issued. Same skip-the-empty-stage walk as before; the
-- only change is that a stage with a tie of holders lands unclaimed instead of
-- being forced onto the oldest assignment.
create or replace function advance_stage(p_request_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r        requests%rowtype;
  v_from   int;
  s        record;
  v_holder uuid;
  v_count  int;
begin
  select * into r from requests where id = p_request_id;
  if not found then raise exception 'No such request.'; end if;

  select stage_no into v_from from category_stages where id = r.current_stage_id;

  for s in
    select cs.* from category_stages cs
    where cs.category_id = r.category_id
      and cs.stage_kind = 'approval'
      and (v_from is null or cs.stage_no > v_from)
    order by cs.stage_no
  loop
    v_holder := resolve_stage_holder(p_request_id, s.id);
    if v_holder is not null then
      v_count := top_tier_holder_count(p_request_id, s.id);

      update requests
      set current_stage_id = s.id,
          current_holder   = case when v_count > 1 then null else v_holder end,
          current_level_id = s.level_id,
          status           = 'in_review'
      where id = p_request_id;

      insert into request_assignment_history
        (request_id, from_user, to_user, acted_by, action, note)
      values (p_request_id, r.current_holder,
              case when v_count > 1 then null else v_holder end,
              auth.uid(), 'stage_advanced',
              case when v_count > 1
                   then s.name || ' — open to claim (' || v_count || ' can act)'
                   else s.name end);

      return s.id;
    end if;

    insert into request_assignment_history
      (request_id, acted_by, action, note)
    values (p_request_id, auth.uid(), 'stage_skipped',
            s.name || ' — nobody currently holds that role here');
  end loop;

  return null;
end;
$$;

-- Take ownership of an unclaimed stage. Atomic: the update only fires while
-- current_holder is still null, so of two people clicking Claim at the same
-- moment exactly one wins and the other is told so. Claiming is as sensitive
-- as deciding, so it needs a second factor.
create or replace function claim_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r      requests%rowtype;
  v_kind text;
begin
  select * into r from requests where id = p_request_id;
  if not found then raise exception 'No such request.'; end if;

  if not has_mfa() then
    raise exception 'Two-factor authentication is required to claim a request.';
  end if;
  if r.current_stage_id is null then
    raise exception 'This request is not at a stage that can be claimed.';
  end if;
  select stage_kind into v_kind from category_stages where id = r.current_stage_id;
  if v_kind <> 'approval' then
    raise exception 'This request is not awaiting an approval.';
  end if;
  if not is_eligible_stage_holder(p_request_id, r.current_stage_id, auth.uid()) then
    raise exception 'You do not hold the role this stage is waiting on.';
  end if;

  update requests set current_holder = auth.uid()
  where id = p_request_id and current_holder is null;
  if not found then
    raise exception 'Someone else has already claimed this request.';
  end if;

  insert into request_assignment_history (request_id, from_user, to_user, acted_by, action)
  values (p_request_id, null, auth.uid(), auth.uid(), 'claimed');
end;
$$;

-- For the UI: may I claim this one? Lets the detail view show a Claim button
-- only to the people who actually can, instead of to everyone who can see the
-- unclaimed ticket (a senior who outranks the stage can see it but not claim).
create or replace function can_claim_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select r.current_holder is null
     and r.current_stage_id is not null
     and (select stage_kind from category_stages where id = r.current_stage_id) = 'approval'
     and is_eligible_stage_holder(p_request_id, r.current_stage_id, auth.uid())
  from requests r where r.id = p_request_id;
$$;

-- The ids, among everything the caller can see, that they can claim. One round
-- trip for the list view to mark its rows, since a PostgREST filter cannot call
-- the eligibility function itself.
create or replace function my_claimable_request_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select r.id from requests r
  where r.current_holder is null
    and r.current_stage_id is not null
    and r.status = 'in_review'
    and is_eligible_stage_holder(r.id, r.current_stage_id, auth.uid());
$$;

-- can_see_request(), re-issued with one extra arm: an unclaimed approval stage
-- is visible to everyone who could claim it. Narrowed to current_holder IS NULL
-- on purpose — once someone claims it, the peers fall back to the ordinary
-- rank/visibility rules and do not keep seeing each other's claimed tickets.
create or replace function can_see_request(p_request_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from requests r
    where r.id = p_request_id and (
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
      -- NEW (0042): an unclaimed approval stage, visible to anyone who can claim it.
      or (
        r.current_holder is null
        and r.current_stage_id is not null
        and is_eligible_stage_holder(r.id, r.current_stage_id, auth.uid())
      )
    )
  );
$$;

-- decide_request(), re-issued. Only the holder check changes: an unclaimed
-- request (current_holder null) must be claimed before it can be decided.
-- `is distinct from` so the null case is handled rather than evaluating to a
-- NULL that slips past the guard.
create or replace function decide_request(
  p_request_id uuid, p_decision text, p_note text default null, p_acted_as uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  r       requests%rowtype;
  cat     request_categories%rowtype;
  v_hash  text;
  v_next  uuid;
  v_post  uuid;
begin
  select * into r from requests where id = p_request_id;
  if not found then raise exception 'No such request.'; end if;
  select * into cat from request_categories where id = r.category_id;

  if r.current_holder is distinct from auth.uid() and not has_tag('admin') then
    if r.current_holder is null then
      raise exception 'Claim this request before acting on it.';
    end if;
    raise exception 'This request is not on your desk.';
  end if;

  if not has_mfa() then
    raise exception 'Two-factor authentication is required to decide a request.';
  end if;

  if required_checks_outstanding(p_request_id) > 0 then
    raise exception 'Required checks for this level are still outstanding.';
  end if;

  if p_decision = 'approved' and stage_tasks_outstanding(p_request_id) > 0 then
    raise exception 'Complete this stage''s tasks before approving.';
  end if;

  if p_decision not in ('approved', 'rejected', 'changes_requested') then
    raise exception 'Unknown decision.';
  end if;

  v_hash := request_state_hash(p_request_id);

  if r.decision_mode = 'approval' then
    insert into signatures (request_id, signer_id, acted_as, level_id, decision, state_hash, note)
    values (p_request_id, auth.uid(), p_acted_as, r.current_level_id, p_decision, v_hash, p_note);
  end if;

  insert into request_assignment_history (request_id, from_user, to_user, acted_by, acted_as, action, note)
  values (p_request_id, auth.uid(), null, auth.uid(), p_acted_as, p_decision, p_note);

  if p_decision = 'approved' and r.current_stage_id is not null then
    v_next := advance_stage(p_request_id);
    if v_next is not null then
      return;
    end if;
  end if;

  if p_decision = 'approved' then
    select cs.id into v_post
    from category_stages cs
    where cs.category_id = r.category_id and cs.stage_kind = 'post_approval'
    order by cs.stage_no
    limit 1;
  end if;

  update requests
  set status = case
        when p_decision = 'approved' then (case when r.decision_mode = 'log_only' then 'reviewed' else 'approved' end)::request_status
        when p_decision = 'rejected' then 'rejected'::request_status
        else 'changes_requested'::request_status
      end,
      current_holder = case when p_decision = 'changes_requested' then r.requested_by else null end,
      current_stage_id = case when p_decision = 'approved' then v_post else r.current_stage_id end,
      closed_at = case when p_decision in ('approved', 'rejected') then now() else null end,
      participants_open_until = case
        when p_decision = 'approved' and cat.participant_phase = 'after_approval'
          then now() + make_interval(days => cat.participant_window_days)
        else r.participants_open_until
      end
  where id = p_request_id;

  if v_post is not null then
    insert into request_assignment_history (request_id, acted_by, acted_as, action, note)
    values (p_request_id, auth.uid(), p_acted_as, 'stage_advanced',
            (select name from category_stages where id = v_post) || ' — follow-up');
  end if;
end;
$$;

-- forward_request(), re-issued with the same claim-before-acting guard.
create or replace function forward_request(
  p_request_id uuid, p_to_user uuid, p_note text default null, p_acted_as uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare r requests%rowtype;
begin
  select * into r from requests where id = p_request_id;
  if not found then raise exception 'No such request.'; end if;

  if r.current_holder is distinct from auth.uid() and not has_tag('admin') then
    if r.current_holder is null then
      raise exception 'Claim this request before moving it on.';
    end if;
    raise exception 'This request is not on your desk.';
  end if;

  if required_checks_outstanding(p_request_id) > 0 then
    raise exception 'Complete this level''s required checks before forwarding.';
  end if;

  if stage_tasks_outstanding(p_request_id) > 0 then
    raise exception 'Complete this stage''s tasks before moving this on.';
  end if;

  update requests
  set current_holder = p_to_user,
      status = 'in_review',
      current_level_id = (
        select pl.id
        from role_assignments ra
        join priority_levels pl on pl.id = ra.level_id
        where ra.user_id = p_to_user
          and assignment_is_current(ra.valid_from, ra.valid_until)
        order by pl.rank
        limit 1
      )
  where id = p_request_id;

  insert into request_assignment_history (request_id, from_user, to_user, acted_by, acted_as, action, note)
  values (p_request_id, auth.uid(), p_to_user, auth.uid(), p_acted_as, 'forwarded', p_note);
end;
$$;

-- record_task_result(), re-issued. Only the stage_role branch changes: it used
-- `r.current_holder = auth.uid()`, which is NULL (not false) on an unclaimed
-- request and so slipped past the `if not v_ok` guard. `is not distinct from`
-- makes an unclaimed request correctly refuse — the task is filled in by
-- whoever the request is with, and nobody is, so it must be claimed first.
create or replace function record_task_result(
  p_request_id uuid, p_task_id uuid, p_answer jsonb,
  p_participant_id uuid default null, p_note text default null, p_acted_as uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  t        stage_tasks%rowtype;
  r        requests%rowtype;
  v_ok     boolean;
  v_result text;
  v_kind   text;
  v_no     int;
  v_post   uuid;
begin
  select * into t from stage_tasks where id = p_task_id;
  if not found then raise exception 'No such task.'; end if;

  select * into r from requests where id = p_request_id;
  if not found then raise exception 'No such request.'; end if;

  if not can_see_request(p_request_id) then
    raise exception 'No such request.';
  end if;

  if t.stage_id is distinct from r.current_stage_id then
    raise exception 'That task belongs to a different stage of this request.';
  end if;

  if t.scope = 'per_participant' and p_participant_id is null then
    raise exception 'This task is answered per participant.';
  end if;
  if t.scope = 'request' and p_participant_id is not null then
    raise exception 'This task is answered once for the whole request.';
  end if;

  case t.actor
    when 'stage_role' then
      v_ok := (r.current_holder is not distinct from auth.uid()) or has_tag('admin');
      if not v_ok then raise exception 'Claim this request first — this task is filled in by whoever the request is with.'; end if;
    when 'requester' then
      v_ok := (r.requested_by = auth.uid()) or has_tag('admin');
      if not v_ok then raise exception 'This task is filled in by the person who raised the request.'; end if;
    when 'any_participant' then
      v_ok := (r.requested_by = auth.uid()) or has_tag('admin') or exists (
        select 1 from request_participants rp
        where rp.request_id = p_request_id and rp.member_id = auth.uid()
          and rp.acceptance_status = 'accepted'
      );
      if not v_ok then raise exception 'Only someone on this request can fill that in.'; end if;
  end case;

  if p_answer is null or p_answer = 'null'::jsonb then
    raise exception 'An answer is required.';
  end if;

  if t.passing_answers is null then
    v_result := 'passed';
  elsif t.passing_answers @> jsonb_build_array(p_answer #>> '{}') then
    v_result := 'passed';
  else
    v_result := 'failed';
  end if;

  delete from request_check_results
  where request_id = p_request_id and task_id = p_task_id
    and participant_id is not distinct from p_participant_id;

  insert into request_check_results
    (request_id, task_id, participant_id, result, answer, acted_by, acted_as, note)
  values
    (p_request_id, p_task_id, p_participant_id, v_result, p_answer, auth.uid(), p_acted_as, p_note);

  select cs.stage_kind, cs.stage_no into v_kind, v_no
  from category_stages cs where cs.id = t.stage_id;

  if v_kind = 'post_approval' and stage_tasks_outstanding(p_request_id) = 0 then
    select cs.id into v_post
    from category_stages cs
    where cs.category_id = r.category_id
      and cs.stage_kind = 'post_approval'
      and cs.stage_no > v_no
    order by cs.stage_no
    limit 1;

    update requests set current_stage_id = v_post where id = p_request_id;

    insert into request_assignment_history (request_id, acted_by, acted_as, action, note)
    values (p_request_id, auth.uid(), p_acted_as, 'stage_advanced',
            coalesce((select name from category_stages where id = v_post) || ' — follow-up',
                     'follow-up complete'));
  end if;
end;
$$;

-- my_notifications(), re-issued with one extra feed item: a request has landed
-- on a stage you can act on but nobody has claimed it. Without this a second
-- mentor would see the ticket in a list but never be told it arrived — which
-- is the whole complaint this change answers.
create or replace function my_notifications(p_limit integer default 50)
returns jsonb language sql stable set search_path = public as $$
  with me as (select auth.uid() as id),
  feed as (
    select h.id::text || ':assigned' as nid, 'assigned' as kind, h.request_id, h.created_at as at,
           h.acted_by as actor, null::text as detail
    from request_assignment_history h, me
    where h.to_user = me.id and h.acted_by is distinct from me.id
      and h.action in ('submitted', 'stage_advanced', 'forwarded')
    union all
    select h.id::text || ':outcome', 'outcome:' || h.action, h.request_id, h.created_at, h.acted_by, h.note
    from request_assignment_history h
    join requests r on r.id = h.request_id, me
    where r.requested_by = me.id and h.acted_by is distinct from me.id
      and h.action in ('approved', 'rejected', 'changes_requested', 'reviewed')
    union all
    select h.id::text || ':progress', 'progress', h.request_id, h.created_at, h.acted_by, h.note
    from request_assignment_history h
    join requests r on r.id = h.request_id, me
    where r.requested_by = me.id and h.acted_by is distinct from me.id and h.action = 'stage_advanced'
    union all
    select c.id::text || ':comment', 'comment', c.request_id, c.created_at, c.author_id, left(c.body, 140)
    from request_comments c
    join requests r on r.id = c.request_id, me
    where c.author_id <> me.id and (r.requested_by = me.id or r.current_holder = me.id)
    union all
    -- NEW (0042): a request is on a stage you can act on and is unclaimed.
    select r.id::text || ':claimable', 'claimable', r.id, coalesce(r.submitted_at, r.created_at),
           null::uuid, null::text
    from requests r, me
    where r.current_holder is null
      and r.current_stage_id is not null
      and r.status = 'in_review'
      and is_eligible_stage_holder(r.id, r.current_stage_id, me.id)
  ),
  shaped as (
    select f.nid, f.kind, f.request_id, r.reference_number, r.title, f.at, f.detail,
           p.full_name as actor_name
    from feed f
    join requests r on r.id = f.request_id
    left join profiles p on p.id = f.actor
    order by f.at desc
    limit greatest(least(coalesce(p_limit, 50), 200), 1)
  )
  select jsonb_build_object(
    'seen_at', (select seen_at from notification_state where user_id = auth.uid()),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', nid, 'kind', kind, 'request_id', request_id, 'reference', reference_number, 'title', title,
        'at', at, 'detail', detail, 'actor', actor_name) order by at desc) from shaped), '[]'::jsonb)
  );
$$;

grant execute on function is_eligible_stage_holder(uuid, uuid, uuid) to authenticated;
grant execute on function top_tier_holder_count(uuid, uuid) to authenticated;
grant execute on function claim_request(uuid) to authenticated;
grant execute on function can_claim_request(uuid) to authenticated;
grant execute on function my_claimable_request_ids() to authenticated;
