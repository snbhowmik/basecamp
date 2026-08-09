-- Basecamp v1.0.0 — Core Schema
-- ============================================================

create extension if not exists "pgcrypto";

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

-- ============================================================
-- IDENTITY
-- ============================================================

create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null,
  email         text not null unique,
  phone         text,
  avatar_key    text,
  is_active     boolean not null default true,
  mfa_enrolled  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

-- `set search_path = public` is required, not defensive styling: this
-- trigger fires on auth.users, in a transaction run by supabase_auth_admin
-- (the role GoTrue connects as), whose search_path is pinned to `auth` only
-- by the base image — a deliberate security boundary. Without pinning our
-- own search_path here, the unqualified `profiles` reference below fails to
-- resolve at all ("relation does not exist"), not just as a lint nit.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Reflects MFA enrollment state from Supabase Auth's own mfa_factors table.
-- Same search_path requirement as handle_new_user() above — fires on
-- auth.mfa_factors, in supabase_auth_admin's session context.
create or replace function sync_mfa_enrolled()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'verified' then
    update profiles set mfa_enrolled = true where id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger auth_mfa_factor_verified
  after insert or update on auth.mfa_factors
  for each row execute function sync_mfa_enrolled();

-- ============================================================
-- HIERARCHY — priority levels + tags, not a fixed role enum
-- ============================================================

create table priority_levels (
  id          uuid primary key default gen_random_uuid(),
  rank        int  not null unique,   -- 1 = top; lower rank = higher authority
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table tags (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,   -- 'hod', 'mentor', 'dept:cs', 'club:robotics', 'admin'
  label       text not null,
  tag_type    text,                   -- informal grouping only, not enforced
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table user_tags (
  user_id    uuid not null references profiles(id) on delete cascade,
  tag_id     uuid not null references tags(id) on delete cascade,
  granted_by uuid references profiles(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, tag_id)
);

create table user_levels (
  user_id     uuid primary key references profiles(id) on delete cascade,
  level_id    uuid not null references priority_levels(id),
  assigned_by uuid references profiles(id),
  assigned_at timestamptz not null default now()
);

-- ============================================================
-- ORG STRUCTURE
-- ============================================================

create table departments (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  code      text not null unique,
  tag_id    uuid references tags(id),   -- the tag that identifies "belongs to this dept"
  is_active boolean not null default true
);

create table classes (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  year          int  not null,
  department_id uuid not null references departments(id),
  tag_id        uuid references tags(id),
  is_active     boolean not null default true
);

create table student_profiles (
  user_id       uuid primary key references profiles(id) on delete cascade,
  reg_no        text not null unique,
  year          int  not null,
  department_id uuid not null references departments(id),
  class_id      uuid references classes(id),
  is_complete   boolean not null default false
);

create table allowed_login_domains (
  id         uuid primary key default gen_random_uuid(),
  domain     text not null unique,
  is_active  boolean not null default true,
  added_by   uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- REQUEST TAXONOMY
-- ============================================================

create type decision_mode as enum ('approval', 'log_only');

create type request_status as enum (
  'draft', 'submitted', 'in_review',
  'changes_requested', 'approved', 'rejected',
  'reviewed', 'cancelled', 'closed'
);

create type travel_scope as enum ('internal', 'outstation');

create table request_types (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  name      text not null,
  is_active boolean not null default true
);

create table request_categories (
  id                             uuid primary key default gen_random_uuid(),
  request_type_id                uuid not null references request_types(id) on delete cascade,
  parent_id                      uuid references request_categories(id) on delete cascade,
  code                           text not null,
  name                           text not null,
  decision_mode                  decision_mode not null default 'approval',
  -- If true, request_attachments are kept forever (e.g. certificates).
  -- If false, they're purged automatically once the request is closed.
  retain_attachments_after_close boolean not null default true,
  is_active                      boolean not null default true,
  sort_order                     int not null default 0,
  unique(request_type_id, parent_id, code)
);

create table category_first_hop_options (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references request_categories(id) on delete cascade,
  label       text not null,
  resolve_tag text not null,     -- tag code to resolve against at submit time
  is_default  boolean not null default false,
  sort_order  int not null default 0
);

create table field_definitions (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references request_categories(id) on delete cascade,
  code        text not null,
  label       text not null,
  data_type   text not null,     -- 'text' | 'number' | 'date' | 'select' | 'file' | 'checkbox'
  is_required boolean not null default false,
  config      jsonb not null default '{}'::jsonb,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  unique(category_id, code)
);

create table request_field_values (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null,   -- FK added after requests table exists
  field_def_id uuid not null references field_definitions(id),
  value        jsonb not null,
  unique(request_id, field_def_id)
);

-- ============================================================
-- REQUESTS
-- ============================================================

create sequence request_ref_seq start 1;

create table requests (
  id               uuid primary key default gen_random_uuid(),
  reference_number text not null unique
    default ('REQ-' || to_char(now(),'YYYY') || '-' || lpad(nextval('request_ref_seq')::text, 5, '0')),

  category_id      uuid not null references request_categories(id),
  decision_mode    decision_mode not null,   -- copied at creation, immutable after

  title            text not null,
  description      text,
  status           request_status not null default 'draft',

  travel_scope     travel_scope,
  event_name       text,
  organised_by     text,
  event_location   text,
  start_date       date,
  end_date         date,

  requested_by     uuid not null references profiles(id),
  current_holder   uuid references profiles(id),

  submitted_at     timestamptz,
  event_reviewed_at timestamptz,   -- post-event review completed
  completed_at     timestamptz,
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger requests_updated_at before update on requests
  for each row execute function set_updated_at();

alter table request_field_values
  add constraint fk_request foreign key (request_id) references requests(id) on delete cascade;

create index requests_by_requester on requests (requested_by, status);
create index requests_by_holder    on requests (current_holder) where current_holder is not null;
create index requests_by_category  on requests (category_id, status);

create table request_assignment_history (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  from_user  uuid references profiles(id),
  to_user    uuid not null references profiles(id),
  note       text,
  action     text not null,   -- 'forwarded' | 'approved' | 'rejected' | 'changes_requested' | 'reviewed'
  created_at timestamptz not null default now()
);
create index assignment_history_by_request on request_assignment_history (request_id, created_at);

create table request_watchers (
  request_id uuid not null references requests(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  reason     text not null,   -- 'mandatory_mentor' | 'mandatory_hod' | 'manual'
  primary key (request_id, user_id)
);

-- ============================================================
-- COMMENTS & CANVAS
-- ============================================================

create type comment_visibility as enum ('public', 'internal');

create table request_comments (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references requests(id) on delete cascade,
  author_id   uuid not null references profiles(id),
  visibility  comment_visibility not null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index comments_by_request on request_comments (request_id, created_at);

create table canvases (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid references requests(id) on delete cascade,
  visibility  comment_visibility not null default 'internal',
  title       text not null,
  owner_id    uuid not null references profiles(id),
  created_at  timestamptz not null default now()
);

create table canvas_revisions (
  id         uuid primary key default gen_random_uuid(),
  canvas_id  uuid not null references canvases(id) on delete cascade,
  revision   int not null,
  content    jsonb not null,
  author_id  uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  unique(canvas_id, revision)
);

-- ============================================================
-- SIGNATURES — approval-flow decisions
-- ============================================================

create table signatures (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id),
  signer_id  uuid not null references profiles(id),
  action     text not null,   -- 'approved' | 'rejected' | 'changes_requested'
  state_hash text not null,
  note       text,
  signed_at  timestamptz not null default now()
);

create or replace function signatures_immutable()
returns trigger language plpgsql as $$
begin raise exception 'Signatures are append-only.'; end;
$$;
create trigger signatures_no_update before update on signatures
  for each row execute function signatures_immutable();
create trigger signatures_no_delete before delete on signatures
  for each row execute function signatures_immutable();

-- ============================================================
-- STORED SIGNATURE ASSETS — one active per person, reused everywhere
-- ============================================================

create table signature_assets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  object_key text not null,       -- cleaned, transparent PNG, in Garage
  source     text not null,       -- 'canvas' | 'upload'
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index one_active_signature_per_user
  on signature_assets (user_id) where is_active;

-- ============================================================
-- GENERATED DOCUMENTS — Annexure 4.4, NOC, future templates
-- Rendered on demand; the row is the source of truth, the PDF is cache.
-- ============================================================

create type generated_document_type as enum ('annexure_4_4', 'noc');

create table generated_documents (
  id                 uuid primary key default gen_random_uuid(),
  request_id         uuid not null references requests(id),
  document_type      generated_document_type not null,
  reference_code     text not null unique,      -- printed on the PDF, publicly verifiable
  state_hash         text not null,              -- hash of the request state used to generate
  signature_ids      uuid[] not null default '{}',
  generated_by       uuid references profiles(id),
  generated_at       timestamptz not null default now(),
  cached_object_key  text                        -- optional; safe to purge and regenerate
);

-- ============================================================
-- OUTSTATION PARTICIPANTS — snapshot + parent consent as a record
-- ============================================================

create table request_participants (
  id                          uuid primary key default gen_random_uuid(),
  request_id                  uuid not null references requests(id) on delete cascade,
  student_id                  uuid not null references profiles(id),
  snapshot_name               text not null,
  snapshot_reg_no             text not null,
  is_leader                   boolean not null default false,

  -- Parent consent — a verified record, never a file. The mentor calls,
  -- confirms verbally, and fills this in. See PRD §14.2.
  parent_consent_verified     boolean not null default false,
  parent_consent_verified_by  uuid references profiles(id),
  parent_consent_verified_at  timestamptz,
  parent_name                 text,
  parent_contact              text,
  transport_mode              text,
  consent_note                text,

  unique(request_id, student_id)
);

-- ============================================================
-- ATTACHMENTS — with purge lifecycle
-- ============================================================

create table request_attachments (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references requests(id) on delete cascade,
  purpose      text not null,     -- 'event_poster', 'certificate', 'selection_letter', ...
  object_key   text not null,     -- Garage key, never a URL
  mime_type    text not null,
  size_bytes   bigint not null,
  checksum     text not null,
  uploaded_by  uuid not null references profiles(id),
  -- Set by trigger when the parent request closes, per the category's
  -- retain_attachments_after_close flag. Null = never scheduled for purge.
  purge_after  timestamptz,
  created_at   timestamptz not null default now()
);
create index attachments_pending_purge on request_attachments (purge_after)
  where purge_after is not null;

-- ============================================================
-- DASHBOARD ACCESS — separate from approval authority
-- ============================================================

create table dashboard_grants (
  user_id       uuid not null references profiles(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  granted_by    uuid references profiles(id),
  granted_at    timestamptz not null default now(),
  primary key (user_id, department_id)
);

-- ============================================================
-- STUDENT ACTIVITY SUMMARY — for the reviewer-facing panel
-- ============================================================

create view student_activity_summary as
select
  sp.user_id,
  count(*) filter (
    where rc.parent_id = (select id from request_categories where code = 'tech' limit 1)
  ) as tech_count,
  count(*) filter (
    where rc.parent_id = (select id from request_categories where code = 'non_tech' limit 1)
  ) as non_tech_count,
  count(*) filter (where r.status in ('approved', 'reviewed')) as total_completed
from student_profiles sp
join requests r on r.requested_by = sp.user_id
join request_categories rc on rc.id = r.category_id
group by sp.user_id;
