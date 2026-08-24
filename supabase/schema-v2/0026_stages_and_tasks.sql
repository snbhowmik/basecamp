-- 0026 — Admin-authored stages and tasks, and who may file
-- ============================================================
-- The complaint this answers: "the options are baked in."
--
-- It was accurate, and more so than the tables suggest. `level_checks` has
-- existed since 0002 — and has never had a single write RPC or a line of UI.
-- `RoutingEditor` edits `category_first_hop_options` and nothing else. So the
-- checklist model was structurally present and unauthorable in practice, which
-- from the captain's chair is indistinguishable from hardcoded.
--
-- Worse, `check_type` is one of three fixed strings ('manual',
-- 'all_participants_consented', 'field_present'). Even with a UI, a captain
-- could not have written "parent permission taken [yes/no]" — only picked from
-- a menu the schema chose in advance. That is the actual baked-in part.
--
-- And `category_level_roles.participation = 'approves'` is read by NOTHING.
-- add_configured_watchers() (0004) filters on 'notified'; required_checks_
-- outstanding() keys on requests.current_level_id. There is no stage sequence
-- in the runtime at all — a request advances because a holder calls
-- forward_request() and names a person. `sort_order` on that table is
-- decorative. So stages are a new advancement mechanism, not a config table,
-- and building one preserves no behaviour that anything depends on.
--
-- The model, in the captain's words: a category has stages; each stage is
-- checked by one role; each stage has one or more tasks; when the tasks are
-- filled the stage is done.
--
-- Every default here preserves current behaviour. A category with no stages
-- routes exactly as it does today.

-- ============================================================
-- STAGES
-- ============================================================
-- A stage is its own row rather than a (category, level) pair. The pair form
-- (category_level_roles) is primary-keyed on both columns, which structurally
-- forbids two stages held by the same role — "mentor verifies, HOD reviews,
-- mentor countersigns" would be unrepresentable. Since the 'approves' half of
-- that table is dead code, nothing is preserved by reusing it.
--
-- category_level_roles stays as it is, for its 'notified' rows: watchers are
-- a live feature and this migration does not touch them.
create table category_stages (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references request_categories(id) on delete cascade,

  -- Explicit and enforced, not decorative. 0027 gates advancement on it.
  stage_no    int  not null,
  name        text not null,

  -- The role that checks this stage. A level, not a person: the ticket is
  -- routed to whoever currently holds that level in the requester's subtree,
  -- which is the same resolution rule first-hop options already use.
  level_id    uuid not null references priority_levels(id),

  -- A stage the requester may skip past when no task in it is required.
  -- Distinct from having no tasks: a stage can be purely informational.
  is_optional boolean not null default false,

  created_at  timestamptz not null default now(),
  unique (category_id, stage_no)
);
create index category_stages_category on category_stages (category_id, stage_no);

-- ============================================================
-- TASKS
-- ============================================================
create table stage_tasks (
  id       uuid primary key default gen_random_uuid(),
  stage_id uuid not null references category_stages(id) on delete cascade,
  label    text not null,

  -- The shape of the answer, chosen by the captain. This is the column that
  -- unbakes level_checks.check_type: 'parent permission taken [yes/no]' is
  -- answer_type 'yes_no'; 'submitted proof of selection' is 'file'.
  answer_type text not null check (answer_type in (
    'yes_no',       -- two buttons
    'choice',       -- options[] radio
    'text',
    'number',
    'date',
    'file',         -- an attachment must be present
    'acknowledge'   -- a single tick, no value: "I have read this"
  )),

  -- For 'choice'. A json array of strings: ["Selected", "Waitlisted", "Not selected"]
  options jsonb,

  -- Which answers clear the task. A json array; null means any answer clears
  -- it. For 'yes_no' the captain decides whether "no" is a valid outcome or a
  -- blocker — "parent permission taken: no" should NOT let the stage close,
  -- so its passing_answers is ["yes"].
  passing_answers jsonb,

  -- Who fills this in. The captain's own example needs all three: the mentor
  -- ticks parent permission, the STUDENT submits proof of selection. Without
  -- this column the second one is impossible — request_check_results' insert
  -- policy requires holds_kind('academic') AND being the current holder, and
  -- a student is neither. 0027's record_task_result() enforces this.
  actor text not null default 'stage_role'
        check (actor in ('stage_role', 'requester', 'any_participant')),

  -- 'per_participant' means one answer per person on a group request — the
  -- mentor confirms parent consent for each student, not once for the ticket.
  scope text not null default 'request'
        check (scope in ('request', 'per_participant')),

  is_required boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create index stage_tasks_stage on stage_tasks (stage_id, sort_order);

-- ============================================================
-- RESULTS — one table, not two
-- ============================================================
-- request_check_results already exists and already carries acted_by/acted_as,
-- the two partial unique indexes, and an RLS read policy. Rather than stand up
-- a parallel request_task_results beside it, task_id joins check_id and
-- exactly one of them is set.
--
-- The `result` / `answer` split, stated so the next reader does not have to
-- guess: `result` stays "did this task clear" and is what the gate counts;
-- `answer` carries what was actually chosen. A 'choice' task with three
-- options has no self-evident mapping to passed/failed — passing_answers is
-- what defines it, and record_task_result() applies that rule once, server
-- side, rather than letting each caller decide.
alter table request_check_results
  add column task_id uuid references stage_tasks(id) on delete cascade,
  add column answer  jsonb;

alter table request_check_results alter column check_id drop not null;

alter table request_check_results
  add constraint rcr_one_source check (num_nonnulls(check_id, task_id) = 1);

create unique index rcr_task_per_participant on request_check_results (request_id, task_id, participant_id)
  where task_id is not null and participant_id is not null;
create unique index rcr_task_per_request on request_check_results (request_id, task_id)
  where task_id is not null and participant_id is null;

-- ============================================================
-- WHO MAY FILE
-- ============================================================
-- category_first_hop_options is who RECEIVES a request first. Nothing has ever
-- gated who may RAISE one — any member can file against any active category.
--
-- By tag, never by a role name in code: "a student club administrator may
-- apply for an event ticket" has to be configurable, or it is the same baked-in
-- problem in a new place.
create table category_initiators (
  category_id uuid not null references request_categories(id) on delete cascade,
  tag_id      uuid not null references tags(id),
  primary key (category_id, tag_id)
);

comment on table category_initiators is
  'Tags permitted to file against a category. A category with NO rows here is '
  'open to everyone — that is today''s behaviour, so existing categories keep '
  'working and nobody has to configure every category before this ships. '
  'Enforced in create_and_submit_request() (0027), not in the frontend.';

-- ============================================================
-- WHEN PARTICIPANTS ARE COLLECTED
-- ============================================================
-- "when it gets approved the club administrator gets a window to add the OD
-- participants". Today participants are added before submission; this lets a
-- category say: approve the event first, then collect the names.
alter table request_categories
  add column participant_phase text not null default 'before_submit'
      check (participant_phase in ('before_submit', 'after_approval')),
  -- How long the window stays open once it opens. Days rather than a date the
  -- approver picks: the approver is deciding on the request, not scheduling,
  -- and one fewer field on the approval screen is one fewer thing to get wrong.
  add column participant_window_days int not null default 7
      check (participant_window_days between 1 and 90);

alter table requests
  -- Set when an 'after_approval' category is approved. A timestamp rather than
  -- a status so the window can outlive the approval without a scheduler.
  add column participants_open_until timestamptz,
  -- Which stage the ticket is sitting at. Null for categories with no stages
  -- configured, which is every category today.
  add column current_stage_id uuid references category_stages(id);

-- ============================================================
-- RLS
-- ============================================================
-- 0003 and 0009 build their policies by iterating a literal array of table
-- names, so a table created here lands with none. Written out by hand for
-- exactly that reason, and the assertion at the end of this file is 0003's,
-- repeated, so a table added and forgotten fails the migration.
do $$
declare t text;
begin
  foreach t in array array['category_stages', 'stage_tasks', 'category_initiators'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    -- Readable by any signed-in member: you cannot fill in a task you cannot
    -- see, and the requester needs to see the chain their request will walk.
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_read', t);
    -- Insert and update only. Deletion has no policy at all and can happen
    -- only inside admin_delete(), which is 0009's rule and applies here too.
    execute format(
      'create policy %I on %I for insert to authenticated '
      'with check (has_tag(''admin'') or can_bootstrap())', t || '_insert', t);
    execute format(
      'create policy %I on %I for update to authenticated '
      'using (has_tag(''admin'') or can_bootstrap()) '
      'with check (has_tag(''admin'') or can_bootstrap())', t || '_update', t);
  end loop;
end
$$;

-- admin_delete()'s allowlist is a literal array too. Without this the captain
-- can create a stage and never remove one. blocking_references() is catalog
-- driven, so it already refuses to strand a request_check_results row.
create or replace function admin_delete(p_table text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_blocked text;
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
  if not recently_verified_totp() then
    raise exception 'Confirm with your authenticator before deleting. The code must be entered again for each deletion.';
  end if;
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

-- ============================================================
-- 0003's assertion, repeated
-- ============================================================
-- v1 shipped request_field_values with no RLS because it was missed by two
-- enumerated loops. This file adds three tables to a schema whose policies are
-- built the same way, which is the same trap. Fail here rather than ship a
-- world-readable table.
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ')
  into missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  if missing is not null then
    raise exception 'Tables in public without RLS enabled: %', missing;
  end if;
end
$$;

notify pgrst, 'reload schema';
