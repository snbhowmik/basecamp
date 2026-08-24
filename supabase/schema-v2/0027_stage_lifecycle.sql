-- 0027 — Stages in the runtime: authoring, advancement, tasks, printing
-- ============================================================
-- 0026 added the tables. This is the half that makes them mean something.
--
-- Two rules shape every function below.
--
-- 1. Every write is ONE call. The captain asked for save/cancel on the config
--    screens, and the reason given was fewer concurrent connections. A Save
--    button that then fires twelve rpc() calls in a loop has the button and
--    none of the benefit — so each editor sends its whole changed set as one
--    jsonb payload, diffed here inside one transaction.
--
-- 2. Every function carries `security definer` and `set search_path = public`,
--    explicitly, including the ones that are `create or replace` of an
--    existing function. 0024 omitted that word on two replacements and took
--    the site down for a day; the attribute is replaced along with the body.

-- ============================================================
-- AUTHORING — one RPC per editor
-- ============================================================

-- Replaces a category's whole stage list. p_stages is a json array of
-- { id?, stage_no, name, level_id, is_optional }. Rows with an id are updated,
-- rows without are inserted, and any stage not in the payload is removed.
create or replace function save_category_stages(p_category_id uuid, p_stages jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_keep uuid[];
  v_used text;
  s      jsonb;
  v_id   uuid;
begin
  if not (has_tag('admin') or can_bootstrap()) then
    raise exception 'Only the captain can change a category''s stages.';
  end if;
  if jsonb_typeof(p_stages) <> 'array' then
    raise exception 'Stages must be sent as a list.';
  end if;

  for s in select * from jsonb_array_elements(p_stages) loop
    v_id := nullif(s ->> 'id', '')::uuid;

    if v_id is null then
      insert into category_stages (category_id, stage_no, name, level_id, is_optional)
      values (
        p_category_id,
        (s ->> 'stage_no')::int,
        trim(s ->> 'name'),
        (s ->> 'level_id')::uuid,
        coalesce((s ->> 'is_optional')::boolean, false)
      )
      returning id into v_id;
    else
      update category_stages
      set stage_no    = (s ->> 'stage_no')::int,
          name        = trim(s ->> 'name'),
          level_id    = (s ->> 'level_id')::uuid,
          is_optional = coalesce((s ->> 'is_optional')::boolean, false)
      where id = v_id and category_id = p_category_id;
      if not found then
        raise exception 'That stage does not belong to this category.';
      end if;
    end if;

    v_keep := array_append(v_keep, v_id);
  end loop;

  -- Removing a stage cascades to its tasks and, through them, to any answers
  -- already recorded against a live request. Refuse rather than cascade: a
  -- silent delete of somebody's recorded parent-consent check is not something
  -- a config screen should be able to do.
  select string_agg(distinct cs.name, ', ')
  into v_used
  from category_stages cs
  join stage_tasks st on st.stage_id = cs.id
  join request_check_results rr on rr.task_id = st.id
  where cs.category_id = p_category_id
    and not (cs.id = any(coalesce(v_keep, '{}'::uuid[])));

  if v_used is not null then
    raise exception 'These stages have answers recorded against live requests and cannot be removed: %.', v_used;
  end if;

  delete from category_stages
  where category_id = p_category_id
    and not (id = any(coalesce(v_keep, '{}'::uuid[])));
end;
$$;

-- Replaces one stage's whole task list. p_tasks is a json array of
-- { id?, label, answer_type, options?, passing_answers?, actor, scope,
--   is_required, sort_order }.
create or replace function save_stage_tasks(p_stage_id uuid, p_tasks jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_keep uuid[];
  v_used text;
  t      jsonb;
  v_id   uuid;
begin
  if not (has_tag('admin') or can_bootstrap()) then
    raise exception 'Only the captain can change a stage''s tasks.';
  end if;
  if jsonb_typeof(p_tasks) <> 'array' then
    raise exception 'Tasks must be sent as a list.';
  end if;
  if not exists (select 1 from category_stages where id = p_stage_id) then
    raise exception 'No such stage.';
  end if;

  for t in select * from jsonb_array_elements(p_tasks) loop
    v_id := nullif(t ->> 'id', '')::uuid;

    -- A 'choice' task with no options is a dead end in the UI: the person
    -- filling it in is shown a radio group with nothing to pick.
    if (t ->> 'answer_type') = 'choice'
       and coalesce(jsonb_array_length(t -> 'options'), 0) = 0 then
      raise exception 'The task "%" is a choice but has no options.', trim(t ->> 'label');
    end if;

    if v_id is null then
      insert into stage_tasks (
        stage_id, label, answer_type, options, passing_answers,
        actor, scope, is_required, sort_order
      )
      values (
        p_stage_id,
        trim(t ->> 'label'),
        t ->> 'answer_type',
        t -> 'options',
        t -> 'passing_answers',
        coalesce(t ->> 'actor', 'stage_role'),
        coalesce(t ->> 'scope', 'request'),
        coalesce((t ->> 'is_required')::boolean, true),
        coalesce((t ->> 'sort_order')::int, 0)
      )
      returning id into v_id;
    else
      update stage_tasks
      set label           = trim(t ->> 'label'),
          answer_type     = t ->> 'answer_type',
          options         = t -> 'options',
          passing_answers = t -> 'passing_answers',
          actor           = coalesce(t ->> 'actor', 'stage_role'),
          scope           = coalesce(t ->> 'scope', 'request'),
          is_required     = coalesce((t ->> 'is_required')::boolean, true),
          sort_order      = coalesce((t ->> 'sort_order')::int, 0)
      where id = v_id and stage_id = p_stage_id;
      if not found then
        raise exception 'That task does not belong to this stage.';
      end if;
    end if;

    v_keep := array_append(v_keep, v_id);
  end loop;

  select string_agg(distinct st.label, ', ')
  into v_used
  from stage_tasks st
  join request_check_results rr on rr.task_id = st.id
  where st.stage_id = p_stage_id
    and not (st.id = any(coalesce(v_keep, '{}'::uuid[])));

  if v_used is not null then
    raise exception 'These tasks have answers recorded against live requests and cannot be removed: %.', v_used;
  end if;

  delete from stage_tasks
  where stage_id = p_stage_id
    and not (id = any(coalesce(v_keep, '{}'::uuid[])));
end;
$$;

-- Whole set in one call, same as the others. An empty array means "open to
-- everyone", which is what a category with no rows already means.
create or replace function save_category_initiators(p_category_id uuid, p_tag_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (has_tag('admin') or can_bootstrap()) then
    raise exception 'Only the captain can change who may file a request.';
  end if;

  delete from category_initiators
  where category_id = p_category_id
    and not (tag_id = any(coalesce(p_tag_ids, '{}'::uuid[])));

  insert into category_initiators (category_id, tag_id)
  select p_category_id, unnest(coalesce(p_tag_ids, '{}'::uuid[]))
  on conflict do nothing;
end;
$$;

-- The whole configuration of a category in one read, nested, so the editor
-- loads with one call rather than one per stage.
create or replace function category_workflow(p_category_id uuid)
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'category_id', p_category_id,
    'initiators', coalesce((
      select jsonb_agg(jsonb_build_object('tag_id', t.id, 'code', t.code, 'label', t.label) order by t.label)
      from category_initiators ci join tags t on t.id = ci.tag_id
      where ci.category_id = p_category_id
    ), '[]'::jsonb),
    'stages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', cs.id,
          'stage_no', cs.stage_no,
          'name', cs.name,
          'level_id', cs.level_id,
          'level_name', pl.name,
          'is_optional', cs.is_optional,
          'tasks', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', st.id,
                'label', st.label,
                'answer_type', st.answer_type,
                'options', st.options,
                'passing_answers', st.passing_answers,
                'actor', st.actor,
                'scope', st.scope,
                'is_required', st.is_required,
                'sort_order', st.sort_order
              ) order by st.sort_order, st.label
            )
            from stage_tasks st where st.stage_id = cs.id
          ), '[]'::jsonb)
        ) order by cs.stage_no
      )
      from category_stages cs
      join priority_levels pl on pl.id = cs.level_id
      where cs.category_id = p_category_id
    ), '[]'::jsonb)
  );
$$;

grant execute on function save_category_stages(uuid, jsonb)      to authenticated;
grant execute on function save_stage_tasks(uuid, jsonb)          to authenticated;
grant execute on function save_category_initiators(uuid, uuid[]) to authenticated;
grant execute on function category_workflow(uuid)                to authenticated;

-- ============================================================
-- WHO MAY FILE
-- ============================================================
-- No rows for the category means open to everyone. The frontend mirrors this
-- in its picker, but the picker is a convenience — this is the boundary.
create or replace function may_file_category(p_category_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select not exists (select 1 from category_initiators where category_id = p_category_id)
      or exists (
        select 1 from category_initiators ci
        join user_tags ut on ut.tag_id = ci.tag_id
        where ci.category_id = p_category_id and ut.user_id = auth.uid()
      )
      or has_tag('admin');
$$;

grant execute on function may_file_category(uuid) to authenticated;

-- ============================================================
-- ADVANCEMENT
-- ============================================================

-- Whoever currently holds a stage's level, within the request's own subtree.
-- Null when nobody does — a level configured but unfilled is a normal state,
-- not an error (0002's note on category_level_roles), so the caller treats a
-- null here as "skip this stage" rather than stalling the ticket.
create or replace function resolve_stage_holder(p_request_id uuid, p_stage_id uuid)
returns uuid language sql security definer stable set search_path = public as $$
  select ra.user_id
  from category_stages cs
  join requests r on r.id = p_request_id
  join role_assignments ra on ra.level_id = cs.level_id
    and assignment_is_current(ra.valid_from, ra.valid_until)
  where cs.id = p_stage_id
    and ra.user_id <> r.requested_by
    and (ra.org_unit_id is null or r.org_unit_id is null
         or in_org_subtree(ra.org_unit_id, r.org_unit_id))
  -- A holder scoped to the request's own org unit beats an institute-wide
  -- one, and a primary assignment beats a secondary. Otherwise oldest first,
  -- so the same person is picked every time rather than at the planner's whim.
  order by ra.is_primary desc, (ra.org_unit_id is not null) desc, ra.assigned_at
  limit 1;
$$;

-- Required tasks in the request's current stage with no passing answer yet.
-- Per-participant tasks count once per participant, which is why this is not
-- a plain count of stage_tasks.
create or replace function stage_tasks_outstanding(p_request_id uuid)
returns int language sql security definer stable set search_path = public as $$
  select coalesce(sum(needed), 0)::int
  from (
    select st.id,
      case when st.scope = 'per_participant'
        then (select count(*) from request_participants rp
              where rp.request_id = r.id and rp.acceptance_status <> 'declined')
        else 1
      end
      -
      (select count(*) from request_check_results rr
       where rr.request_id = r.id and rr.task_id = st.id and rr.result = 'passed')
      as needed
    from requests r
    join stage_tasks st on st.stage_id = r.current_stage_id
    where r.id = p_request_id and st.is_required
  ) q
  where needed > 0;
$$;

grant execute on function resolve_stage_holder(uuid, uuid)  to authenticated;
grant execute on function stage_tasks_outstanding(uuid)     to authenticated;

-- Move a request to the next stage that has a holder, skipping unfilled ones.
-- Returns the stage landed on, or null when the chain is finished.
create or replace function advance_stage(p_request_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r        requests%rowtype;
  v_from   int;
  s        record;
  v_holder uuid;
begin
  select * into r from requests where id = p_request_id;
  if not found then raise exception 'No such request.'; end if;

  select stage_no into v_from from category_stages where id = r.current_stage_id;

  for s in
    select cs.* from category_stages cs
    where cs.category_id = r.category_id
      and (v_from is null or cs.stage_no > v_from)
    order by cs.stage_no
  loop
    v_holder := resolve_stage_holder(p_request_id, s.id);
    if v_holder is not null then
      update requests
      set current_stage_id = s.id,
          current_holder   = v_holder,
          current_level_id = s.level_id,
          status           = 'in_review'
      where id = p_request_id;

      insert into request_assignment_history
        (request_id, from_user, to_user, acted_by, action, note)
      values (p_request_id, r.current_holder, v_holder, auth.uid(), 'stage_advanced', s.name);

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

grant execute on function advance_stage(uuid) to authenticated;

-- ============================================================
-- FILLING IN A TASK
-- ============================================================
-- This exists as an RPC rather than as a widened RLS policy because the actor
-- rules cannot be written as one `with check`. request_check_results' insert
-- policy demands holds_kind('academic') AND being the current holder, which is
-- right for a mentor's verification and wrong for the student uploading proof
-- of selection — and the captain's own example has both in one stage.
--
-- The frontend never writes this table directly, so the policy stays as it is
-- and this is the only path in.
create or replace function record_task_result(
  p_request_id     uuid,
  p_task_id        uuid,
  p_answer         jsonb,
  p_participant_id uuid default null,
  p_note           text default null,
  p_acted_as       uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  t       stage_tasks%rowtype;
  r       requests%rowtype;
  v_ok    boolean;
  v_result text;
begin
  select * into t from stage_tasks where id = p_task_id;
  if not found then raise exception 'No such task.'; end if;

  select * into r from requests where id = p_request_id;
  if not found then raise exception 'No such request.'; end if;

  if not can_see_request(p_request_id) then
    raise exception 'No such request.';
  end if;

  -- The task must belong to the stage the request is actually sitting at.
  -- Without this, anyone could fill in a later stage's tasks early and the
  -- gate would pass the moment the ticket arrived there.
  if t.stage_id is distinct from r.current_stage_id then
    raise exception 'That task belongs to a different stage of this request.';
  end if;

  if t.scope = 'per_participant' and p_participant_id is null then
    raise exception 'This task is answered per participant.';
  end if;
  if t.scope = 'request' and p_participant_id is not null then
    raise exception 'This task is answered once for the whole request.';
  end if;

  -- Who is allowed to answer.
  case t.actor
    when 'stage_role' then
      v_ok := (r.current_holder = auth.uid()) or has_tag('admin');
      if not v_ok then raise exception 'This task is filled in by whoever the request is with.'; end if;
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

  -- `result` is "did this clear"; `answer` is what was chosen. passing_answers
  -- null means any answer clears the task — which is right for a text note and
  -- wrong for "parent permission taken", whose passing_answers is ["yes"].
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
end;
$$;

grant execute on function record_task_result(uuid, uuid, jsonb, uuid, text, uuid) to authenticated;

-- ============================================================
-- ADDING PARTICIPANTS — by register number, and in a window
-- ============================================================
-- The scan option. A barcode scan produces a register number and nothing else,
-- so the whole feature is this one lookup; the camera work is the browser's.
--
-- The student is added as `pending`. Scanning someone's card adds them to the
-- request; it does not consent on their behalf — they still accept in their
-- own inbox, which is what request_participants.acceptance_status is for.
create or replace function add_participant_by_reg_no(p_request_id uuid, p_reg_no text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r        requests%rowtype;
  cat      request_categories%rowtype;
  v_user   uuid;
  v_name   text;
  v_reg    text;
  v_id     uuid;
begin
  select * into r from requests where id = p_request_id;
  if not found then raise exception 'No such request.'; end if;
  select * into cat from request_categories where id = r.category_id;

  -- Who may add. The requester always may; for an 'after_approval' category
  -- the window is open to anyone holding an initiator tag, which is how two
  -- club administrators both add students at the same time.
  if not (r.requested_by = auth.uid() or has_tag('admin') or may_file_category(r.category_id)) then
    raise exception 'You cannot add people to this request.';
  end if;

  if cat.participant_phase = 'after_approval' then
    if r.participants_open_until is null then
      raise exception 'Participants can be added once this request is approved.';
    end if;
    if r.participants_open_until < now() then
      raise exception 'The window for adding participants closed on %.',
        to_char(r.participants_open_until, 'DD Mon YYYY');
    end if;
  elsif r.status <> 'draft' and r.requested_by <> auth.uid() and not has_tag('admin') then
    raise exception 'This request no longer accepts new participants.';
  end if;

  select mp.user_id, p.full_name, mp.reg_no
  into v_user, v_name, v_reg
  from member_profiles mp
  join profiles p on p.id = mp.user_id
  where upper(trim(mp.reg_no)) = upper(trim(p_reg_no))
    and p.is_active;

  if v_user is null then
    raise exception 'No active member has register number %.', trim(p_reg_no);
  end if;

  -- Two club administrators scanning the same student is normal, not an error.
  select id into v_id from request_participants
  where request_id = p_request_id and member_id = v_user;
  if v_id is not null then
    return v_id;
  end if;

  insert into request_participants
    (request_id, member_id, snapshot_name, snapshot_reg_no, acceptance_status)
  values (p_request_id, v_user, v_name, coalesce(v_reg, ''), 'pending')
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function add_participant_by_reg_no(uuid, text) to authenticated;

-- ============================================================
-- THE PRINT GATE
-- ============================================================
-- "after that's done generate the pdf and show." Every stage has either signed
-- off or had nobody to sign, and no required task anywhere is outstanding.
--
-- render_document() (0020) already refuses when the caller cannot see the
-- request. This is the completeness half, and it is deliberately separate:
-- one answers "may you", the other answers "is it finished".
create or replace function can_print(p_request_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select can_see_request(p_request_id)
     and exists (select 1 from requests where id = p_request_id
                 and status in ('approved', 'reviewed', 'closed'))
     and not exists (
       -- A stage that has a holder but no approval signature at its level.
       --
       -- Only for an 'approval' category. A log_only type writes no signature
       -- at all by design (decide_request, 0017) — demanding one here would
       -- mean a log_only document could never be printed, which is how this
       -- was first written and what the end-to-end run caught.
       select 1 from category_stages cs
       join requests r on r.id = p_request_id and r.category_id = cs.category_id
       where r.decision_mode = 'approval'
         and resolve_stage_holder(p_request_id, cs.id) is not null
         and not exists (
           select 1 from signatures sg
           where sg.request_id = p_request_id
             and sg.level_id = cs.level_id
             and sg.decision = 'approved'
         )
     )
     and not exists (
       -- Any required task, in any stage, still unanswered.
       select 1 from category_stages cs
       join requests r on r.id = p_request_id and r.category_id = cs.category_id
       join stage_tasks st on st.stage_id = cs.id and st.is_required
       where not exists (
         select 1 from request_check_results rr
         where rr.request_id = p_request_id and rr.task_id = st.id and rr.result = 'passed'
       )
     );
$$;

grant execute on function can_print(uuid) to authenticated;

notify pgrst, 'reload schema';
