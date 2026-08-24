-- 0028 — The three lifecycle RPCs, taught about stages
-- ============================================================
-- 0026 added the tables, 0027 the authoring and advancement. Nothing yet
-- CALLS any of it: create_and_submit_request(), forward_request() and
-- decide_request() are still 0004/0017's, which know only about
-- current_level_id and level_checks.
--
-- All three are replaced below. Each is the existing body with the stage
-- handling added — bodies otherwise unchanged, so a category with no stages
-- configured behaves exactly as it does today. That is every category that
-- exists right now, which is what makes this migration safe to apply to a
-- live instance.
--
-- SECURITY DEFINER and `set search_path = public` are written on every one of
-- them. `create or replace function` replaces the security attribute along
-- with the body; 0024 left the word off two replacements and every
-- authenticated request failed for a day.

-- ============================================================
-- SUBMIT
-- ============================================================
create or replace function create_and_submit_request(
  p_category_id uuid,
  p_title       text,
  p_body        text,
  p_first_hop   uuid,
  p_acted_as    uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_mode decision_mode;
  v_org  uuid;
  v_ref  text;
  v_stage uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  -- NEW: who may raise this. Nothing gated initiation before — any member
  -- could file against any active category. A category with no initiator rows
  -- is still open to everyone, so this changes nothing until it is configured.
  if not may_file_category(p_category_id) then
    raise exception 'You do not hold a role that can raise this kind of request.';
  end if;

  select rt.decision_mode into v_mode
  from request_categories rc join request_types rt on rt.id = rc.request_type_id
  where rc.id = p_category_id;

  if v_mode is null then
    raise exception 'Unknown request category.';
  end if;

  select org_unit_id into v_org from member_profiles where user_id = auth.uid();
  v_ref := 'REQ-' || to_char(now(), 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into requests (
    reference_number, category_id, decision_mode, requested_by, requested_as,
    title, body, status, current_holder, org_unit_id, submitted_at
  )
  values (
    v_ref, p_category_id, v_mode, auth.uid(), p_acted_as,
    p_title, p_body, 'draft', p_first_hop, v_org, now()
  )
  returning id into v_id;

  update requests set status = 'submitted' where id = v_id;

  insert into request_assignment_history (request_id, from_user, to_user, acted_by, acted_as, action)
  values (v_id, auth.uid(), p_first_hop, auth.uid(), p_acted_as, 'submitted');

  -- NEW: if the category has stages, they decide where this goes, not the
  -- first-hop picker. advance_stage() lands on the first stage somebody
  -- actually holds and rewrites current_holder; the picker's answer stands
  -- only for categories with no stages, which is the existing behaviour.
  v_stage := advance_stage(v_id);

  return v_id;
end;
$$;

-- ============================================================
-- FORWARD
-- ============================================================
create or replace function forward_request(
  p_request_id uuid,
  p_to_user    uuid,
  p_note       text default null,
  p_acted_as   uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
declare r requests%rowtype;
begin
  select * into r from requests where id = p_request_id;
  if not found then raise exception 'No such request.'; end if;

  if r.current_holder <> auth.uid() and not has_tag('admin') then
    raise exception 'This request is not on your desk.';
  end if;

  if required_checks_outstanding(p_request_id) > 0 then
    raise exception 'Complete this level''s required checks before forwarding.';
  end if;

  -- NEW: the stage's own tasks gate the hop. This is the "when the tasks are
  -- filled the stage is done" rule — a stage cannot be walked past with a
  -- required task unanswered, and the count is per participant where the task
  -- says so.
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

-- ============================================================
-- DECIDE
-- ============================================================
-- The hash and signature half is 0017's, untouched: changing what
-- request_state_hash() covers would retroactively invalidate every signature
-- already written, and /verify recomputes the same function.
--
-- What changes is what "approved" MEANS when the category has stages. Before,
-- approving closed the request. Now approving closes the STAGE, and the ticket
-- moves to the next stage that has a holder; only when the chain runs out does
-- the request itself close.
create or replace function decide_request(
  p_request_id uuid,
  p_decision   text,
  p_note       text default null,
  p_acted_as   uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  r       requests%rowtype;
  cat     request_categories%rowtype;
  v_hash  text;
  v_next  uuid;
begin
  select * into r from requests where id = p_request_id;
  if not found then raise exception 'No such request.'; end if;
  select * into cat from request_categories where id = r.category_id;

  if r.current_holder <> auth.uid() and not has_tag('admin') then
    raise exception 'This request is not on your desk.';
  end if;

  if not has_mfa() then
    raise exception 'Two-factor authentication is required to decide a request.';
  end if;

  if required_checks_outstanding(p_request_id) > 0 then
    raise exception 'Required checks for this level are still outstanding.';
  end if;

  -- NEW, and only for an approval: a rejection must always be possible. A
  -- mentor who cannot approve because a task failed still has to be able to
  -- say no, and blocking that would strand the ticket on their desk.
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

  -- NEW: an approval on a staged category hands the ticket to the next stage.
  -- The signature above is already written, so the trail records that this
  -- level approved even though the request has not finished.
  if p_decision = 'approved' and r.current_stage_id is not null then
    v_next := advance_stage(p_request_id);
    if v_next is not null then
      return;
    end if;
  end if;

  update requests
  set status = case
        when p_decision = 'approved' then (case when r.decision_mode = 'log_only' then 'reviewed' else 'approved' end)::request_status
        when p_decision = 'rejected' then 'rejected'::request_status
        else 'changes_requested'::request_status
      end,
      current_holder = case when p_decision = 'changes_requested' then r.requested_by else null end,
      closed_at = case when p_decision in ('approved', 'rejected') then now() else null end,
      -- NEW: the window to add OD participants opens here, and only for a
      -- category configured to collect them after approval. A timestamp
      -- rather than a status, so it can lapse without anything running.
      participants_open_until = case
        when p_decision = 'approved' and cat.participant_phase = 'after_approval'
          then now() + make_interval(days => cat.participant_window_days)
        else r.participants_open_until
      end
  where id = p_request_id;
end;
$$;

grant execute on function create_and_submit_request(uuid, text, text, uuid, uuid) to authenticated;
grant execute on function decide_request(uuid, text, text, uuid) to authenticated;
grant execute on function forward_request(uuid, uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
