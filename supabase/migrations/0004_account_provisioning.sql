-- Basecamp v1.0.0 — Cascading Account Provisioning
-- ============================================================
-- Nobody but the captain self-registers freely. Every other account is
-- pre-provisioned by someone who already holds the right level: Captain
-- invites Dean/HOD/anyone directly, a Dean invites HOD for their own scope,
-- an HOD invites Mentor/Student/Student Outreach Faculty for their own
-- department. See README.md "No Fixture Data" and NOTE.md's dated entry on
-- this migration for the reasoning.
--
-- Mechanism: an invite is a row in `pending_assignments` keyed by email —
-- no auth.users row, no password, nothing GoTrue-visible yet. The moment
-- that email actually signs up through the normal self-service flow (same
-- signUp() the captain used), a trigger on `profiles` matches it and grants
-- the pre-declared level + tags automatically. No service_role key in the
-- frontend, no custom backend — matches the "PostgREST + RLS only" shape
-- of everything else in this schema.

-- ============================================================
-- STRUCTURAL TAG VOCABULARY
-- ============================================================
-- 'hod' and 'mentor' are referenced by exact code in is_hod_of()/
-- is_mentor_of() (0002_functions_and_rls.sql) — they're part of the
-- schema's contract, not org-specific data, so ensuring they exist is
-- infrastructure, not fixture data (unlike departments/levels/accounts,
-- which stay entirely captain-created — see README.md). 'dean' and
-- 'student_outreach' aren't referenced by any RLS function; included as
-- convention defaults matching the org model described directly by the
-- operator, safe to rename or deactivate later via the tags table.
insert into tags (code, label, tag_type) values
  ('hod', 'Head of Department', 'function'),
  ('mentor', 'Mentor', 'function'),
  ('dean', 'Dean', 'function'),
  ('student_outreach', 'Student Outreach Faculty', 'function')
on conflict (code) do nothing;

-- ============================================================
-- PENDING ASSIGNMENTS
-- ============================================================

create table pending_assignments (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  level_id       uuid not null references priority_levels(id),
  tag_codes      text[] not null default '{}',
  department_id  uuid references departments(id),
  class_id       uuid references classes(id),
  reg_no         text,   -- optional, student invites only — see apply_pending_assignment()
  year           int,    -- optional, student invites only
  invited_by     uuid not null references profiles(id),
  created_at     timestamptz not null default now(),
  consumed_at    timestamptz
);
create index pending_assignments_open on pending_assignments (lower(email)) where consumed_at is null;

-- ============================================================
-- can_invite() — the authorization rule for who may create an invite for
-- what. Deliberately rank-based, not hardcoded to level names (matches
-- "priority levels aren't fixed roles" — PRD §6.1): the inviter must
-- outrank the level they're inviting into, and if the invite is scoped to
-- a department, the inviter must themselves hold that department's tag
-- (covers both Dean-of-department and HOD, uniformly, without special-
-- casing either).
-- ============================================================

create or replace function can_invite(target_level_id uuid, target_department_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select
    has_tag('admin')
    or (
      my_rank() is not null
      and my_rank() < (select rank from priority_levels where id = target_level_id)
      and (
        target_department_id is null
        or exists (
          select 1 from user_tags ut
          join departments d on d.tag_id = ut.tag_id
          where ut.user_id = auth.uid() and d.id = target_department_id
        )
      )
    );
$$;

alter table pending_assignments enable row level security;
alter table pending_assignments force row level security;

create policy pending_assignments_read on pending_assignments for select
using (invited_by = auth.uid() or has_tag('admin'));

create policy pending_assignments_insert on pending_assignments for insert
with check (
  invited_by = auth.uid()
  and has_mfa()
  and can_invite(level_id, department_id)
);

create policy pending_assignments_delete on pending_assignments for delete
using (invited_by = auth.uid() or has_tag('admin'));

-- ============================================================
-- apply_pending_assignment() — fires after handle_new_user() has already
-- created the profiles row (0001_schema.sql), in the same transaction.
-- Matches by email, grants the pre-declared level + tags + department/class
-- scoping, creates a student_profiles row if this looks like a student
-- invite (department_id set, no staff tag_codes), and marks the invite
-- consumed. If no matching invite exists, does nothing — the captain's own
-- signup (during bootstrap) and any signup that slips through without an
-- invite (shouldn't happen once check_allowed_domain() is extended below,
-- but this function stays a no-op either way rather than erroring) are
-- both fine.
-- ============================================================

create or replace function apply_pending_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pa pending_assignments%rowtype;
  dept_tag_id uuid;
  class_tag_id uuid;
  code text;
  matched_tag_id uuid;
begin
  select * into pa from pending_assignments
  where lower(email) = lower(new.email) and consumed_at is null
  limit 1;

  if not found then
    return new;
  end if;

  insert into user_levels (user_id, level_id, assigned_by)
  values (new.id, pa.level_id, pa.invited_by);

  foreach code in array pa.tag_codes loop
    select id into matched_tag_id from tags where tags.code = code;
    if matched_tag_id is not null then
      insert into user_tags (user_id, tag_id, granted_by)
      values (new.id, matched_tag_id, pa.invited_by)
      on conflict do nothing;
    end if;
  end loop;

  if pa.department_id is not null then
    select tag_id into dept_tag_id from departments where id = pa.department_id;
    if dept_tag_id is not null then
      insert into user_tags (user_id, tag_id, granted_by)
      values (new.id, dept_tag_id, pa.invited_by)
      on conflict do nothing;
    end if;
  end if;

  if pa.class_id is not null then
    select tag_id into class_tag_id from classes where id = pa.class_id;
    if class_tag_id is not null then
      insert into user_tags (user_id, tag_id, granted_by)
      values (new.id, class_tag_id, pa.invited_by)
      on conflict do nothing;
    end if;
  end if;

  -- Student-shaped invite: has a department, no staff tags declared.
  if pa.department_id is not null and coalesce(array_length(pa.tag_codes, 1), 0) = 0 then
    insert into student_profiles (user_id, reg_no, year, department_id, class_id, is_complete)
    values (
      new.id,
      coalesce(pa.reg_no, 'PENDING-' || substr(new.id::text, 1, 8)),
      coalesce(pa.year, 1),
      pa.department_id,
      pa.class_id,
      pa.reg_no is not null
    );
  end if;

  update pending_assignments set consumed_at = now() where id = pa.id;

  return new;
end;
$$;

create trigger on_profile_created_apply_assignment
  after insert on profiles
  for each row execute function apply_pending_assignment();

-- ============================================================
-- INVITE-ONLY SIGNUP — extends check_allowed_domain() (0002) rather than
-- replacing its trigger attachment. Domain check stays first (cheaper,
-- and the existing error message for that case is more specific). Once
-- bootstrapping is over (the captain exists), every signup needs a live,
-- unconsumed invite — closes the gap where anyone on an allowed domain
-- could previously self-register with no level/tags at all.
-- ============================================================

create or replace function check_allowed_domain()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_domain text;
begin
  v_domain := split_part(new.email, '@', 2);
  if not exists (
    select 1 from allowed_login_domains where domain = v_domain and is_active
  ) then
    raise exception 'Email domain % is not permitted to register.', v_domain;
  end if;

  if not is_bootstrapping() and not exists (
    select 1 from pending_assignments
    where lower(email) = lower(new.email) and consumed_at is null
  ) then
    raise exception 'This email has not been invited to register. Contact your department administrator.';
  end if;

  return new;
end;
$$;
