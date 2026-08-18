-- Basecamp v2.0.0 — Foundation: identity, org structure, roles, authorization helpers
-- ============================================================
-- CONSOLIDATED BASELINE. This is not a migration onto v1 — it is a clean
-- schema replacing 0001..0008, written for a fresh database. Justified by
-- there being exactly one account (the captain) in the only deployment, and
-- by v2 breaking the org model regardless (PRD-V2 §3).
--
-- Fixes folded in from the 2026-08-18 audit rather than patched on top:
--
--   * EVERY security definer function pins `set search_path = public`.
--     v1 left eight of them unpinned — including every core authorization
--     helper — which is the exact footgun NOTE.md's 2026-08-09 entry
--     documents. An unpinned definer function resolves unqualified names
--     using the CALLER's search_path, so the same function silently works
--     or fails depending on who invokes it.
--
--   * `is_lowest_level()` no longer infers the base level from
--     `max(rank)` (SECURITY.md R-27). The base level is now explicit data
--     (`priority_levels.is_base`), so inserting a level below Student
--     cannot silently reclassify who counts as a student. v1 additionally
--     inlined that same max(rank) rule inside search_forward_targets,
--     duplicating a fragile assumption in two places — exactly what
--     ARCH.md §4 forbids.
--
--   * One level per user is gone (`user_levels` PK was on user_id alone).
--     `role_assignments` supports several concurrent, time-boxed roles.

create extension if not exists "pgcrypto";

create or replace function set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

-- ============================================================
-- IDENTITY
-- ============================================================

create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  full_name    text not null,
  mfa_enrolled boolean not null default false,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

-- Mirrors auth.users into profiles on signup. search_path is load-bearing
-- here specifically: this fires as supabase_auth_admin, whose search_path
-- is pinned to `auth`, so `profiles` would not resolve without it.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Keeps profiles.mfa_enrolled in step with GoTrue's own factor table, so
-- RLS and the UI can read enrollment without querying the auth schema.
create or replace function sync_mfa_enrolled()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update profiles p
  set mfa_enrolled = exists (
    select 1 from auth.mfa_factors f
    where f.user_id = p.id and f.status = 'verified'
  )
  where p.id = coalesce(new.user_id, old.user_id);
  return coalesce(new, old);
end;
$$;

-- v1 defined this function and attached it; v2 carried the function across and
-- dropped the trigger, so profiles.mfa_enrolled was written false at signup and
-- never updated again -- the captain's own dashboard showed MFA "Pending" after
-- a completed, mandatory enrollment.
--
-- DELETE is included deliberately. The body recomputes from the factor set
-- rather than latching true the way v1's did, so unenrolling the last verified
-- factor correctly returns the profile to false.
create trigger auth_mfa_factor_changed
  after insert or update or delete on auth.mfa_factors
  for each row execute function sync_mfa_enrolled();

-- ============================================================
-- AUTHORITY — ordered levels, not a role enum
-- ============================================================

create table priority_levels (
  id          uuid primary key default gen_random_uuid(),
  rank        int  not null unique,          -- 1 = highest authority
  name        text not null,
  description text,
  -- Explicit, not inferred. v1 derived "is this the student level?" from
  -- max(rank), which quietly breaks the moment a level is added below the
  -- base one (SECURITY.md R-27). Making it data means a restructure that
  -- forgets to move the flag fails loudly instead of misclassifying users.
  is_base     boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- The role tag a level resolves through -- 'hod' for Head of Department, and
-- so on. Deliberately nullable: the captain names all levels up front during
-- setup but is not forced to invent a tag for each one on the spot, and a
-- level with no tag is a normal state rather than an unfinished one. Added
-- after the table so the reference to tags (declared below) resolves.
alter table priority_levels add column tag_id uuid;

-- At most one base level, enforced by the database rather than by care.
create unique index priority_levels_one_base on priority_levels ((true)) where is_base;

-- ============================================================
-- TAGS — free-form identity markers, hierarchical
-- ============================================================

create table tags (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,        -- 'hod', 'mentor', 'dept:cyber', 'admin'
  label         text not null,
  -- Self-referencing so "ECE ⇒ School of Electrical and Electronics" is
  -- derived by walking parents rather than asserted twice and left to
  -- drift (PRD-V2 §3.2).
  parent_tag_id uuid references tags(id),
  tag_type      text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create index tags_parent on tags (parent_tag_id) where parent_tag_id is not null;

-- priority_levels.tag_id is declared above (the table is defined before tags);
-- the reference is attached here, now that tags exists.
alter table priority_levels
  add constraint priority_levels_tag_id_fkey foreign key (tag_id) references tags(id);

create table user_tags (
  user_id    uuid not null references profiles(id) on delete cascade,
  tag_id     uuid not null references tags(id) on delete cascade,
  granted_by uuid references profiles(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, tag_id)
);

-- ============================================================
-- ORG STRUCTURE — a tree of what is STABLE only
-- ============================================================
-- Faculty → Programme. Batches deliberately are NOT tree nodes: making
-- them nodes grows an entire new subtree every admission year and forces
-- reassigning every HOD annually (PRD-V2 §3.2). Clubs are not a separate
-- tree either — a club coordinator is a role_assignment with
-- role_kind='club' scoped to a programme.
create table org_units (
  id        uuid primary key default gen_random_uuid(),
  parent_id uuid references org_units(id),
  unit_type text not null check (unit_type in ('faculty', 'programme')),
  name      text not null,
  code      text not null,
  campus    text,                            -- 'TRY' etc; only meaningful on a faculty
  tag_id    uuid references tags(id),        -- the tag meaning "belongs to this unit"
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (parent_id, code)
);
create index org_units_parent on org_units (parent_id);

-- A batch is one programme's intake cohort. `mode` (FT/PT) and the year
-- span come from the real register-number format, e.g.
-- "CSE-SC 2024 FT ... 2024-2028" (PRD-V2 §3.2).
create table batches (
  id                 uuid primary key default gen_random_uuid(),
  org_unit_id        uuid not null references org_units(id),
  name               text not null,
  start_year         int  not null,
  end_year           int  not null,
  mode               text not null default 'FT',
  -- Opaque prefix, deliberately NOT decomposed: 'RA2411030050'. Enough to
  -- validate a register number against the batch it claims and to parse the
  -- trailing serial, without encoding a guess about which digits mean what
  -- (PRD-V2 §8).
  reg_no_prefix      text,
  reg_no_serial_len  int default 3,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (org_unit_id, name),
  check (end_year > start_year)
);

-- Batch-scoped by design: 2024's "Cyber Security - A" is a different group
-- of humans from 2025's.
create table sections (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references batches(id) on delete cascade,
  name        text not null,
  serial_from int,
  serial_to   int,
  tag_id      uuid references tags(id),
  is_active   boolean not null default true,
  unique (batch_id, name),
  check (serial_to is null or serial_from is null or serial_to >= serial_from)
);

-- ============================================================
-- MEMBER PROFILES — students and staff in one table
-- ============================================================
-- One table rather than student_profiles + staff_profiles because search
-- has to span both populations, and a union that must stay in sync is a
-- bug waiting to happen (PRD-V2 §11.1). Shape is enforced per member_type
-- by check constraints rather than by convention.
create table member_profiles (
  user_id      uuid primary key references profiles(id) on delete cascade,
  member_type  text not null check (member_type in ('student', 'staff')),

  reg_no       text,                          -- students; never reused
  fet_id       text,                          -- staff

  org_unit_id  uuid references org_units(id), -- programme for both
  batch_id     uuid references batches(id),   -- students
  section_id   uuid references sections(id),  -- students

  -- CGPA is mentor-verified, then locked to the student (PRD-V2 §9.3).
  -- cgpa_verified_by being null is what the UI reads to render "self-
  -- reported" rather than presenting an unchecked number as fact to an
  -- approver who is about to make a decision with it.
  cgpa             numeric(4,2) check (cgpa is null or (cgpa >= 0 and cgpa <= 10)),
  cgpa_proof_key   text,
  cgpa_verified_by uuid references profiles(id),
  cgpa_verified_at timestamptz,
  cgpa_updated_at  timestamptz,

  is_complete  boolean not null default false,
  created_at   timestamptz not null default now(),

  check (member_type <> 'student' or reg_no is not null),
  check (member_type <> 'staff'   or fet_id is not null)
);

-- Partial unique indexes rather than column-level UNIQUE, since only one
-- identifier applies per member_type. Case-insensitive because nobody
-- types a register number consistently.
create unique index member_profiles_reg_no on member_profiles (upper(reg_no)) where reg_no is not null;
create unique index member_profiles_fet_id on member_profiles (upper(fet_id)) where fet_id is not null;
create index member_profiles_org  on member_profiles (org_unit_id);
create index member_profiles_batch on member_profiles (batch_id);

-- Register number is the primary way people are found (PRD-V2 §8.1), so
-- prefix search on it has to be indexed, not a sequential scan over 8,000
-- rows on every keystroke.
create index member_profiles_reg_no_prefix on member_profiles (upper(reg_no) text_pattern_ops) where reg_no is not null;
create index member_profiles_fet_id_prefix on member_profiles (upper(fet_id) text_pattern_ops) where fet_id is not null;

-- Rows whose register number was never supplied are unsearchable by the
-- only handle that matters, so they need to surface as an admin chore
-- rather than sit silent (PRD-V2 §8.1).
create index member_profiles_incomplete on member_profiles (member_type) where not is_complete;

-- ============================================================
-- ROLE ASSIGNMENTS — several at once, scoped, time-boxed
-- ============================================================
-- Replaces v1's user_levels, whose primary key on user_id alone made
-- multi-role structurally impossible. A person can be a Mentor (academic,
-- one programme) and a club coordinator (club, elsewhere) simultaneously,
-- and every action records WHICH capacity was used (PRD-V2 D-1).
create table role_assignments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  level_id    uuid not null references priority_levels(id),
  org_unit_id uuid references org_units(id),      -- null = institute-wide
  section_id  uuid references sections(id),       -- mentors sit at section scope
  role_kind   text not null default 'academic'
              check (role_kind in ('academic', 'club', 'event', 'admin')),
  is_primary  boolean not null default false,
  -- Event roles are created for one techfest and must expire. Expiry as
  -- data, not as a cleanup task someone remembers to run (PRD-V2 §3.1).
  valid_from  timestamptz not null default now(),
  valid_until timestamptz,
  assigned_by uuid references profiles(id),
  assigned_at timestamptz not null default now(),
  unique (user_id, level_id, org_unit_id, section_id, role_kind)
);
create index role_assignments_user on role_assignments (user_id);
create index role_assignments_active on role_assignments (user_id, role_kind)
  where valid_until is null;

create table allowed_login_domains (
  id         uuid primary key default gen_random_uuid(),
  domain     text not null unique,
  is_active  boolean not null default true,
  added_by   uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- Collection windows for CGPA (PRD-V2 §9.3). Outside an open window a
-- student cannot submit their own figure; a mentor may correct one at any
-- time, which is why this gates students only.
create table cgpa_windows (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  opens_at    timestamptz not null,
  closes_at   timestamptz not null,
  org_unit_id uuid references org_units(id),   -- null = institute-wide
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  check (closes_at > opens_at)
);

-- ============================================================
-- AUTHORIZATION HELPERS
-- ============================================================
-- ARCH.md §4's rule, restated because v1 broke it: every relationship
-- check is written ONCE as a security definer function and reused. Never
-- inlined into a policy or an RPC. v1's search_forward_targets inlined the
-- base-level rule instead of calling is_base_level(), which is how the
-- same fragile assumption ended up living in two places.
--
-- Every function below pins search_path. This is not stylistic.

-- Is this assignment live right now? Used by every rank check below, so
-- an expired techfest role stops conferring authority without anyone
-- having to delete the row.
create or replace function assignment_is_current(p_from timestamptz, p_until timestamptz)
returns boolean language sql immutable set search_path = public as $$
  select now() >= p_from and (p_until is null or now() < p_until);
$$;

-- Most senior rank held anywhere. For coarse checks like "may this person
-- see the admin area at all" — never for deciding authority over a
-- specific ticket, which must use my_rank_in().
create or replace function my_best_rank()
returns int language sql security definer stable set search_path = public as $$
  select min(pl.rank)
  from role_assignments ra
  join priority_levels pl on pl.id = ra.level_id
  where ra.user_id = auth.uid()
    and assignment_is_current(ra.valid_from, ra.valid_until);
$$;

-- Walks the org tree upward from a unit, so authority granted at faculty
-- level applies to every programme beneath it without being restated.
create or replace function in_org_subtree(p_ancestor uuid, p_descendant uuid)
returns boolean language sql security definer stable set search_path = public as $$
  with recursive up as (
    select id, parent_id from org_units where id = p_descendant
    union all
    select o.id, o.parent_id from org_units o join up on o.id = up.parent_id
  )
  select p_ancestor is null or exists (select 1 from up where up.id = p_ancestor);
$$;

-- Rank within a given part of the org. An institute-wide assignment
-- (org_unit_id null) counts everywhere; a scoped one counts only inside
-- its own subtree.
create or replace function my_rank_in(p_org_unit uuid)
returns int language sql security definer stable set search_path = public as $$
  select min(pl.rank)
  from role_assignments ra
  join priority_levels pl on pl.id = ra.level_id
  where ra.user_id = auth.uid()
    and assignment_is_current(ra.valid_from, ra.valid_until)
    and (ra.org_unit_id is null or in_org_subtree(ra.org_unit_id, p_org_unit));
$$;

create or replace function has_tag(p_code text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from user_tags ut
    join tags t on t.id = ut.tag_id
    where ut.user_id = auth.uid() and t.code = p_code and t.is_active
  );
$$;

-- Holding 'ECE' satisfies a check for 'School of Electrical and
-- Electronics' by walking parent_tag_id, so membership is stated once at
-- the most specific level and inherited upward (PRD-V2 §3.2).
create or replace function has_tag_or_ancestor(p_code text)
returns boolean language sql security definer stable set search_path = public as $$
  with recursive mine as (
    select t.id, t.parent_tag_id, t.code
    from user_tags ut join tags t on t.id = ut.tag_id
    where ut.user_id = auth.uid() and t.is_active
    union all
    select t.id, t.parent_tag_id, t.code
    from tags t join mine m on t.id = m.parent_tag_id
  )
  select exists (select 1 from mine where code = p_code);
$$;

-- Reads the explicit flag. No max(rank) inference anywhere (R-27).
create or replace function is_lowest_level()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from role_assignments ra
    join priority_levels pl on pl.id = ra.level_id
    where ra.user_id = auth.uid()
      and assignment_is_current(ra.valid_from, ra.valid_until)
      and pl.is_base
  ) and not exists (
    select 1
    from role_assignments ra
    join priority_levels pl on pl.id = ra.level_id
    where ra.user_id = auth.uid()
      and assignment_is_current(ra.valid_from, ra.valid_until)
      and not pl.is_base
  );
$$;

-- Session carries a verified second factor. Sensitive writes gate on this.
create or replace function has_mfa()
returns boolean language sql stable set search_path = public as $$
  select coalesce(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'aal') = 'aal2',
    false
  );
$$;

-- An academic role changes academic things; a club role does not, and
-- vice versa (PRD-V2 §10). This is a WRITE rule distinct from rank: the
-- same person may legitimately outrank a student under their academic hat
-- while acting under a club one, and rank alone would wrongly permit the
-- edit. Without this, D-1's context switch records the capacity used but
-- nothing enforces it — the audit trail would document a violation rather
-- than prevent it.
create or replace function holds_kind(p_kind text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from role_assignments ra
    where ra.user_id = auth.uid()
      and ra.role_kind = p_kind
      and assignment_is_current(ra.valid_from, ra.valid_until)
  );
$$;

-- Bootstrap predicate: true until anyone holds the admin tag. Deliberately
-- NOT "are the tables empty" — that breaks the moment reference data is
-- loaded on a demo instance.
create or replace function is_bootstrapping()
returns boolean language sql security definer stable set search_path = public as $$
  select not exists (
    select 1 from user_tags ut join tags t on t.id = ut.tag_id where t.code = 'admin'
  );
$$;

-- Authorization predicate for the bootstrap window. is_bootstrapping() only
-- reports that setup is unfinished, which is safe to expose but must never be
-- the thing that grants write access: any account that existed during the
-- window would inherit full config rights. This additionally pins the window
-- to the first account created, so the captain -- and nobody who signs up
-- after them -- can configure the instance.
create or replace function can_bootstrap()
returns boolean language sql security definer stable set search_path = public as $$
  select is_bootstrapping()
     and auth.uid() is not null
     and auth.uid() = (select p.id from profiles p order by p.created_at, p.id limit 1);
$$;

grant execute on function my_best_rank(), my_rank_in(uuid), has_tag(text),
  has_tag_or_ancestor(text), is_lowest_level(), has_mfa(), holds_kind(text),
  is_bootstrapping(), can_bootstrap(), in_org_subtree(uuid, uuid) to authenticated;
