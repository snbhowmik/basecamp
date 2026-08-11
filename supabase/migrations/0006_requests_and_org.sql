-- Basecamp v1.0.0 — V2: Request Flow + Org Management
-- ============================================================
-- Everything the V2 UI needs that can't be a plain PostgREST call:
--   * an RLS gap fix on request_field_values (had NO row security at all)
--   * relationship helpers for first-hop routing and staff search
--   * atomic RPCs for submit / decide / forward, because each of those is
--     several writes that must not half-apply (request + assignment history
--     + signature), and because a signature's state_hash has to be computed
--     server-side against the row as actually stored, never client-supplied
--   * create_department / create_batch — each creates a tag AND the row that
--     points at it; splitting that across two client calls leaves orphans
--     when the second one fails
--
-- Convention reminder (README.md, NOTE.md): relationship checks are
-- SECURITY DEFINER functions, written once, called from policies — never
-- inlined joins. can_see_request() below is one of those.

-- ============================================================
-- HARDENING — search_path on an existing trigger function
-- ============================================================
-- add_mandatory_watchers() is SECURITY DEFINER but never pinned its
-- search_path. It happens to work today because it only ever fires from a
-- PostgREST session (search_path = public), unlike the auth.users triggers
-- that broke this way before (NOTE.md, 2026-08-09). Pinning it anyway: the
-- RPCs below call it indirectly, and "works because of where it's called
-- from" is exactly the assumption that broke last time.
create or replace function add_mandatory_watchers()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_class_id uuid;
  v_dept_id  uuid;
  v_mentor   uuid;
  v_hod      uuid;
begin
  if new.status = 'submitted' and (old.status is null or old.status = 'draft') then
    select class_id, department_id into v_class_id, v_dept_id
    from student_profiles where user_id = new.requested_by;

    select ut.user_id into v_mentor
    from user_tags ut
    join tags t on t.id = ut.tag_id and t.code = 'mentor'
    join user_tags ut_class on ut_class.user_id = ut.user_id
    join classes c on c.tag_id = ut_class.tag_id and c.id = v_class_id
    limit 1;

    select ut.user_id into v_hod
    from user_tags ut
    join tags t on t.id = ut.tag_id and t.code = 'hod'
    join user_tags ut_dept on ut_dept.user_id = ut.user_id
    join departments d on d.tag_id = ut_dept.tag_id and d.id = v_dept_id
    limit 1;

    if v_mentor is not null then
      insert into request_watchers (request_id, user_id, reason)
      values (new.id, v_mentor, 'mandatory_mentor') on conflict do nothing;
    end if;
    if v_hod is not null then
      insert into request_watchers (request_id, user_id, reason)
      values (new.id, v_hod, 'mandatory_hod') on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;

-- ============================================================
-- can_see_request() — the one definition of "may this user see this
-- request", mirroring requests_visibility from 0002. Needed as a function
-- (not a repeated subquery) because request_field_values needs the same
-- rule, and referencing an RLS-protected table from inside another table's
-- policy is how you get recursive-policy surprises.
-- ============================================================
create or replace function can_see_request(p_request_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from requests r
    where r.id = p_request_id and (
      r.requested_by = auth.uid()
      or r.current_holder = auth.uid()
      or exists (select 1 from request_watchers w where w.request_id = r.id and w.user_id = auth.uid())
      or exists (select 1 from request_assignment_history h where h.request_id = r.id and h.to_user = auth.uid())
      or exists (
        select 1 from student_profiles sp
        where sp.user_id = r.requested_by and has_dashboard_access(sp.department_id)
      )
      or has_tag('admin')
    )
  );
$$;

-- ============================================================
-- RLS GAP — request_field_values had none at all
-- ============================================================
-- 0002 enabled RLS on every other request-related table but missed this
-- one, and 0003 only covered the catalog tables. PostgREST exposes it, so
-- until now any authenticated user could read or write every custom field
-- value on every request in the system. Logged in SECURITY.md.
alter table request_field_values enable row level security;
alter table request_field_values force row level security;

create policy rfv_read on request_field_values for select
using (can_see_request(request_id));

create policy rfv_write on request_field_values for insert
with check (
  exists (select 1 from requests r where r.id = request_id and r.requested_by = auth.uid())
);

create policy rfv_update on request_field_values for update
using (
  exists (
    select 1 from requests r
    where r.id = request_id and r.requested_by = auth.uid() and r.status = 'draft'
  )
);

-- ============================================================
-- ROUTING HELPERS
-- ============================================================

-- Who can a request of this category go to first? The category's configured
-- picker options resolve to real people by tag — scoped to the requester's
-- own department when the candidate belongs to one at all, so a student
-- can't route to another department's mentor. Candidates with no department
-- (e.g. an institute-wide officer) stay eligible for everyone.
create or replace function list_first_hop_candidates(p_category_id uuid)
returns table (user_id uuid, full_name text, email text, option_label text)
language sql security definer stable set search_path = public as $$
  select distinct p.id, p.full_name, p.email, o.label
  from category_first_hop_options o
  join tags t on t.code = o.resolve_tag
  join user_tags ut on ut.tag_id = t.id
  join profiles p on p.id = ut.user_id and p.is_active
  where o.category_id = p_category_id
    and (
      not exists (
        select 1 from user_tags utx
        join departments dx on dx.tag_id = utx.tag_id
        where utx.user_id = p.id
      )
      or exists (
        select 1 from user_tags uty
        join departments dy on dy.tag_id = uty.tag_id
        where uty.user_id = p.id
          and dy.id = (select sp.department_id from student_profiles sp where sp.user_id = auth.uid())
      )
    )
  order by o.label, p.full_name;
$$;

-- Search-and-forward (PRD §9.2) is deliberately unrestricted — any staff
-- member may forward to any other person. Base-level users are excluded as
-- forward targets since a request should never land back on a student.
create or replace function search_forward_targets(p_query text)
returns table (user_id uuid, full_name text, email text)
language sql security definer stable set search_path = public as $$
  select p.id, p.full_name, p.email
  from profiles p
  join user_levels ul on ul.user_id = p.id
  join priority_levels pl on pl.id = ul.level_id
  where p.is_active
    and p.id <> auth.uid()
    and pl.rank < (select max(rank) from priority_levels)
    and (p.full_name ilike '%' || p_query || '%' or p.email ilike '%' || p_query || '%')
  order by p.full_name
  limit 20;
$$;

-- ============================================================
-- REQUEST LIFECYCLE RPCs
-- ============================================================

create or replace function create_and_submit_request(
  p_category_id    uuid,
  p_title          text,
  p_description    text default null,
  p_first_hop      uuid default null,
  p_travel_scope   travel_scope default null,
  p_event_name     text default null,
  p_organised_by   text default null,
  p_event_location text default null,
  p_start_date     date default null,
  p_end_date       date default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_mode decision_mode;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated.';
  end if;

  select decision_mode into v_mode
  from request_categories where id = p_category_id and is_active;
  if v_mode is null then
    raise exception 'Unknown or inactive category.';
  end if;

  -- requested_by is always auth.uid(), never a parameter — this function is
  -- SECURITY DEFINER, so accepting it from the caller would let anyone file
  -- a request as anyone else.
  insert into requests (
    category_id, decision_mode, title, description, status,
    travel_scope, event_name, organised_by, event_location, start_date, end_date,
    requested_by, current_holder, submitted_at
  ) values (
    p_category_id, v_mode, p_title, nullif(p_description, ''), 'submitted',
    p_travel_scope, nullif(p_event_name, ''), nullif(p_organised_by, ''),
    nullif(p_event_location, ''), p_start_date, p_end_date,
    auth.uid(), p_first_hop, now()
  ) returning id into v_id;

  insert into request_assignment_history (request_id, from_user, to_user, action, note)
  values (v_id, auth.uid(), coalesce(p_first_hop, auth.uid()), 'forwarded', 'Submitted');

  return v_id;
end;
$$;

-- Approve / reject / request-changes (approval mode) or acknowledge
-- (log-only). An approval-mode decision writes a `signatures` row carrying
-- a hash of the request as stored at signing time — that's what makes
-- post-signature tampering detectable (PRD §14.4). Log-only reviews don't
-- produce a signature; there's no decision being signed.
create or replace function decide_request(
  p_request_id uuid,
  p_action     text,
  p_note       text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  r          requests%rowtype;
  v_status   request_status;
  v_hash     text;
begin
  select * into r from requests where id = p_request_id;
  if not found then
    raise exception 'Request not found.';
  end if;
  if r.current_holder is distinct from auth.uid() then
    raise exception 'Only the current holder can act on this request.';
  end if;
  if not has_mfa() then
    raise exception 'This action requires a multi-factor authenticated session.';
  end if;

  if r.decision_mode = 'log_only' then
    if p_action <> 'reviewed' then
      raise exception 'Log-only requests can only be marked reviewed.';
    end if;
    v_status := 'reviewed';
  else
    v_status := case p_action
      when 'approved'          then 'approved'::request_status
      when 'rejected'          then 'rejected'::request_status
      when 'changes_requested' then 'changes_requested'::request_status
      else null
    end;
    if v_status is null then
      raise exception 'Unknown action: %', p_action;
    end if;
  end if;

  update requests
  set status = v_status,
      completed_at = case when v_status in ('approved','rejected','reviewed') then now() else completed_at end,
      current_holder = case when v_status = 'changes_requested' then requested_by else null end
  where id = p_request_id;

  if r.decision_mode = 'approval' then
    select md5(row(rq.id, rq.category_id, rq.title, rq.description, rq.status,
                   rq.travel_scope, rq.event_name, rq.start_date, rq.end_date,
                   rq.requested_by)::text)
    into v_hash from requests rq where rq.id = p_request_id;

    insert into signatures (request_id, signer_id, action, state_hash, note)
    values (p_request_id, auth.uid(), p_action, v_hash, nullif(p_note, ''));
  end if;

  insert into request_assignment_history (request_id, from_user, to_user, action, note)
  values (p_request_id, auth.uid(), r.requested_by, p_action, nullif(p_note, ''));
end;
$$;

create or replace function forward_request(
  p_request_id uuid,
  p_to_user    uuid,
  p_note       text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare r requests%rowtype;
begin
  select * into r from requests where id = p_request_id;
  if not found then
    raise exception 'Request not found.';
  end if;
  if r.current_holder is distinct from auth.uid() then
    raise exception 'Only the current holder can forward this request.';
  end if;
  if not has_mfa() then
    raise exception 'This action requires a multi-factor authenticated session.';
  end if;

  update requests set current_holder = p_to_user, status = 'in_review' where id = p_request_id;

  insert into request_assignment_history (request_id, from_user, to_user, action, note)
  values (p_request_id, auth.uid(), p_to_user, 'forwarded', nullif(p_note, ''));
end;
$$;

-- ============================================================
-- ORG MANAGEMENT — department and batch creation
-- ============================================================
-- Each of these creates a tag AND the row that references it. Two separate
-- client calls would leave an orphan tag whenever the second one fails, and
-- the tag is load-bearing: is_hod_of()/is_mentor_of() resolve scope through
-- departments.tag_id / classes.tag_id.

create or replace function create_department(p_name text, p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tag uuid; v_dept uuid; v_code text;
begin
  if not (has_tag('admin') and has_mfa()) then
    raise exception 'Only the captain can create departments.';
  end if;
  v_code := lower(trim(p_code));

  insert into tags (code, label, tag_type)
  values ('dept:' || v_code, 'Department: ' || p_name, 'scope')
  on conflict (code) do update set label = excluded.label
  returning id into v_tag;

  insert into departments (name, code, tag_id) values (trim(p_name), v_code, v_tag)
  returning id into v_dept;

  return v_dept;
end;
$$;

-- A "class" here is a batch — one department's intake year range, e.g.
-- "2023-2027". Stored as a name string rather than derived from a fixed
-- program length, so irregular batches stay expressible (README.md V2).
create or replace function create_batch(p_department_id uuid, p_name text, p_year int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tag uuid; v_class uuid; v_dept_code text; v_slug text;
begin
  if not (has_tag('admin') and has_mfa()) then
    raise exception 'Only the captain can create batches.';
  end if;

  select code into v_dept_code from departments where id = p_department_id;
  if v_dept_code is null then
    raise exception 'Unknown department.';
  end if;
  v_slug := 'class:' || v_dept_code || ':' || regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g');

  insert into tags (code, label, tag_type)
  values (v_slug, 'Batch: ' || p_name, 'scope')
  on conflict (code) do update set label = excluded.label
  returning id into v_tag;

  insert into classes (name, year, department_id, tag_id)
  values (trim(p_name), p_year, p_department_id, v_tag)
  returning id into v_class;

  return v_class;
end;
$$;

-- ============================================================
-- GRANTS — everything above is called from the browser as `authenticated`
-- ============================================================
-- my_rank()/is_base_level() date from 0002, where they were only ever used
-- inside policies (which don't need a caller-side EXECUTE grant). The V2 UI
-- calls both over PostgREST to decide what to render, so grant them
-- explicitly rather than relying on the default PUBLIC execute privilege
-- surviving a future hardening pass.
grant execute on function my_rank()                         to authenticated;
grant execute on function is_base_level()                   to authenticated;

grant execute on function can_see_request(uuid)             to authenticated;
grant execute on function list_first_hop_candidates(uuid)   to authenticated;
grant execute on function search_forward_targets(text)      to authenticated;
grant execute on function create_and_submit_request(uuid, text, text, uuid, travel_scope, text, text, text, date, date) to authenticated;
grant execute on function decide_request(uuid, text, text)  to authenticated;
grant execute on function forward_request(uuid, uuid, text) to authenticated;
grant execute on function create_department(text, text)     to authenticated;
grant execute on function create_batch(uuid, text, int)     to authenticated;
