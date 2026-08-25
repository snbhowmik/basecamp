-- 0029 — Follow-up after the ticket is approved
-- ============================================================
-- The captain asked what to do with `retain_attachments_after_close`, and
-- whether post-event follow-up ("submit the certificate, the photos, the link
-- to the project") should be a stage that gets asked later.
--
-- Two facts settle it.
--
-- 1. Nothing in this schema has ever set `status = 'closed'`. Grep the whole
--    of schema-v2: the only reader of that value is the purge trigger in 0002,
--    and no code path writes it. So `retain_attachments_after_close` has never
--    fired once — the same shape of problem as level_checks in 0026: a column
--    describing a behaviour that does not exist. The captain's instinct that
--    the boundary belongs at approval rather than at close is right, because
--    approval is the only boundary the runtime actually crosses.
--
-- 2. Stages and tasks, from 0026/0027, already are the follow-up form. A
--    certificate is a task with answer_type 'file'; a project link is 'text';
--    "which of these did you win" is 'choice' with options the captain types.
--    The fields are authored in the UI, which is what was asked for.
--
-- So: yes, it is a stage — one marked `post_approval`. It does not gate the
-- approval chain; it opens when the chain finishes. No new table, no new
-- answer types, and no close state machine: introducing `status = 'closed'`
-- would fire schedule_attachment_purge for the first time ever, and the job
-- that acts on `purge_after` is documented as unbuilt (SECURITY.md R-24).
-- That is a decision to take deliberately, not a side effect of this file.
--
-- Every function below is `create or replace` of an existing one and carries
-- `security definer` and `set search_path = public` explicitly. 0024 left
-- those words off two replacements and took the site down for a day.
-- ============================================================

alter table category_stages
  add column stage_kind text not null default 'approval'
    check (stage_kind in ('approval', 'post_approval'));

comment on column category_stages.stage_kind is
  'approval: part of the chain a request walks before it is decided. '
  'post_approval: opens once the chain finishes — the event happened, now '
  'send in the certificate. Never gates approval and never gates printing.';

-- ============================================================
-- AUTHORING
-- ============================================================

-- Same whole-set diff as 0027, plus stage_kind. A post-approval stage has no
-- holder — decide_request nulls current_holder when it approves — so a task
-- on one that only the stage's role may answer is unanswerable by anybody but
-- an admin. Refused at both ends: here when a stage is turned post-approval
-- under existing tasks, and in save_stage_tasks when a task is added to one.
create or replace function save_category_stages(p_category_id uuid, p_stages jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_keep uuid[];
  v_used text;
  v_bad  text;
  s      jsonb;
  v_id   uuid;
  v_kind text;
begin
  if not (has_tag('admin') or can_bootstrap()) then
    raise exception 'Only the captain can change a category''s stages.';
  end if;
  if jsonb_typeof(p_stages) <> 'array' then
    raise exception 'Stages must be sent as a list.';
  end if;

  for s in select * from jsonb_array_elements(p_stages) loop
    v_id   := nullif(s ->> 'id', '')::uuid;
    v_kind := coalesce(s ->> 'stage_kind', 'approval');

    if v_id is null then
      insert into category_stages (category_id, stage_no, name, level_id, is_optional, stage_kind)
      values (
        p_category_id,
        (s ->> 'stage_no')::int,
        trim(s ->> 'name'),
        (s ->> 'level_id')::uuid,
        coalesce((s ->> 'is_optional')::boolean, false),
        v_kind
      )
      returning id into v_id;
    else
      if v_kind = 'post_approval' then
        select string_agg(st.label, ', ') into v_bad
        from stage_tasks st
        where st.stage_id = v_id and st.actor = 'stage_role';
        if v_bad is not null then
          raise exception
            'Stage "%" has tasks only its role can answer (%), and a post-approval stage sits on nobody''s desk. Change those tasks to be filled in by the requester first.',
            trim(s ->> 'name'), v_bad;
        end if;
      end if;

      update category_stages
      set stage_no    = (s ->> 'stage_no')::int,
          name        = trim(s ->> 'name'),
          level_id    = (s ->> 'level_id')::uuid,
          is_optional = coalesce((s ->> 'is_optional')::boolean, false),
          stage_kind  = v_kind
      where id = v_id and category_id = p_category_id;
      if not found then
        raise exception 'That stage does not belong to this category.';
      end if;
    end if;

    v_keep := array_append(v_keep, v_id);
  end loop;

  -- Removing a stage cascades to its tasks and, through them, to any answers
  -- already recorded against a live request. Refuse rather than cascade.
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

-- 0027's body plus the stage_role refusal on a post-approval stage.
create or replace function save_stage_tasks(p_stage_id uuid, p_tasks jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_keep  uuid[];
  v_used  text;
  v_phase text;
  v_kind  text;
  t       jsonb;
  v_id    uuid;
begin
  if not (has_tag('admin') or can_bootstrap()) then
    raise exception 'Only the captain can change a stage''s tasks.';
  end if;
  if jsonb_typeof(p_tasks) <> 'array' then
    raise exception 'Tasks must be sent as a list.';
  end if;

  select rc.participant_phase, cs.stage_kind into v_phase, v_kind
  from category_stages cs join request_categories rc on rc.id = cs.category_id
  where cs.id = p_stage_id;
  if v_phase is null then
    raise exception 'No such stage.';
  end if;

  for t in select * from jsonb_array_elements(p_tasks) loop
    v_id := nullif(t ->> 'id', '')::uuid;

    if (t ->> 'answer_type') = 'choice'
       and coalesce(jsonb_array_length(t -> 'options'), 0) = 0 then
      raise exception 'The task "%" is a choice but has no options.', trim(t ->> 'label');
    end if;

    if coalesce(t ->> 'scope', 'request') = 'per_participant'
       and coalesce((t ->> 'is_required')::boolean, true)
       and v_phase = 'after_approval' then
      raise exception
        'The task "%" is answered per participant, but this category collects participants only after approval — nobody would be on the request when this stage runs. Make it optional, or collect participants before submission.',
        trim(t ->> 'label');
    end if;

    -- An approved request is on nobody's desk, so "whoever the request is
    -- with" resolves to nobody on a post-approval stage.
    if v_kind = 'post_approval'
       and coalesce(t ->> 'actor', 'stage_role') = 'stage_role' then
      raise exception
        'The task "%" is set to be filled in by whoever the request is with, but this stage runs after approval, when the request is on nobody''s desk. Set it to the requester, or to anyone on the request.',
        trim(t ->> 'label');
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

-- 0027's shape, with stage_kind carried out to the editor.
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
          'stage_kind', cs.stage_kind,
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

-- ============================================================
-- RUNTIME
-- ============================================================

-- 0027's body, walking approval stages only. Without this filter an approval
-- on the last real stage would land the ticket on the follow-up stage, set
-- its status back to 'in_review' and put it on somebody's desk — the event
-- would be waiting on a certificate that cannot exist yet.
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
      and cs.stage_kind = 'approval'
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

-- Printing is a question about the approval chain, not about the follow-up.
-- Both clauses below now say so. A required "upload the certificate" task
-- would otherwise stop every OD letter printing, since the certificate cannot
-- exist until after the event and the letter is needed before it — and a
-- post-approval stage carries no signature at its level either, because a
-- follow-up stage is never decided.
create or replace function can_print(p_request_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select can_see_request(p_request_id)
     and exists (select 1 from requests where id = p_request_id
                 and status in ('approved', 'reviewed', 'closed'))
     and not exists (
       select 1 from category_stages cs
       join requests r on r.id = p_request_id and r.category_id = cs.category_id
       where cs.stage_kind = 'approval'
         and r.decision_mode = 'approval'
         and resolve_stage_holder(p_request_id, cs.id) is not null
         and not exists (
           select 1 from signatures sg
           where sg.request_id = p_request_id
             and sg.level_id = cs.level_id
             and sg.decision = 'approved'
         )
     )
     and not exists (
       select 1 from category_stages cs
       join requests r on r.id = p_request_id and r.category_id = cs.category_id
       join stage_tasks st on st.stage_id = cs.id and st.is_required
       where cs.stage_kind = 'approval'
         and not exists (
           select 1 from request_check_results rr
           where rr.request_id = p_request_id and rr.task_id = st.id and rr.result = 'passed'
         )
     );
$$;

-- 0028's body, plus one thing at the end: an approved request whose category
-- has follow-up stages is parked on the first of them. record_task_result
-- refuses a task that is not on the request's current stage, so the ticket has
-- to sit somewhere for the certificate to be filed against it. Status stays
-- 'approved' and current_holder stays null — the follow-up is the requester's
-- to do, and the ticket is on nobody's desk.
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
  v_post  uuid;
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

-- 0027's body, plus the follow-up chain: when the last required task of a
-- post-approval stage is answered, the request moves to the next follow-up
-- stage. advance_stage is not reused for this — it would set status back to
-- 'in_review' and hand the ticket to a holder.
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

notify pgrst, 'reload schema';
