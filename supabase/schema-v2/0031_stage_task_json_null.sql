-- 0031 — save_stage_tasks() stored JSON null, not SQL null
-- ============================================================
-- Found live: a task saved through the editor with passing_answers left
-- blank (meaning "any answer clears it", per record_task_result's own
-- comment) was unanswerable. `t -> 'passing_answers'` on a jsonb payload
-- extracts the JSON value at that key — when the frontend sends
-- {"passing_answers": null}, that value is the jsonb scalar `null`, not a
-- SQL NULL. record_task_result's `if t.passing_answers is null` never saw
-- it, fell through to the @> containment check against a JSON null, which
-- is always false, and marked every such answer 'failed'. Verified inside
-- a rolled-back transaction against the live "Mentor Approval" task before
-- this fix, and again after.
--
-- Same fix applied to `options` for the same reason, even though nothing
-- currently does an `options is null` check — it's the identical bug on
-- the identical line shape, and leaving it would just relocate the trap.
--
-- SECURITY DEFINER and set search_path = public repeated per HANDOFF's
-- `create or replace function` trap.

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
        nullif(t -> 'options', 'null'::jsonb),
        nullif(t -> 'passing_answers', 'null'::jsonb),
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
          options         = nullif(t -> 'options', 'null'::jsonb),
          passing_answers = nullif(t -> 'passing_answers', 'null'::jsonb),
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

-- Backfill: every task already saved with the JSON-null bug, corrected in
-- place. No behaviour depended on the wrong value — it only ever made
-- record_task_result reject answers it should have accepted.
update stage_tasks set passing_answers = null where passing_answers = 'null'::jsonb;
update stage_tasks set options = null where options = 'null'::jsonb;
