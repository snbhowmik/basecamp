-- Basecamp v2.0.0 — Requests: taxonomy, tickets, routing, and workflow config
-- ============================================================
-- Depends on 0001_foundation.sql.
--
-- What v2 changes here, and why:
--
--   * A level's participation in a category is data (`category_level_roles`):
--     it may `approve`, be `notified`, or be `skipped`. v1 hardcoded "the
--     mentor and HOD are always watchers" in a trigger, which cannot express
--     the techfest case — inform the mentor, block on nobody, route to the
--     event coordinator. The record still shows they were informed, so it is
--     a recorded exception rather than a silent bypass (PRD-V2 D-3).
--
--   * Levels can carry checks that gate the forward (`level_checks`). Flat,
--     with no cross-check dependencies: the real flow is sequential — the
--     mentor verifies each student, the HOD reviews and signs — and sequence
--     already falls out of rank order. Conditional logic across checks needs
--     an expression format, an evaluator, a builder UI and a story for why a
--     ticket is stuck; that is a rule engine, and it is not needed (D-5).
--
--   * Every decision records the capacity it was made in (`acted_as`).
--     Without it D-1's context switch documents a violation rather than
--     preventing one.
--
--   * Categories carry `classification` (tech / non_tech) because that is
--     what person cards and analytics actually count (PRD-V2 §9.1).

-- ============================================================
-- TAXONOMY
-- ============================================================

create type decision_mode as enum ('approval', 'log_only');

create table request_types (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  description   text,
  decision_mode decision_mode not null default 'approval',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Self-referencing tree, unbounded depth: "OD → Tech → Hackathon".
create table request_categories (
  id              uuid primary key default gen_random_uuid(),
  request_type_id uuid not null references request_types(id),
  parent_id       uuid references request_categories(id),
  name            text not null,
  description     text,

  -- Counted by person cards and dashboards, so it lives on the thing being
  -- counted. A tech club running a non-tech event counts as non-tech —
  -- which is why this is not a property of the club (PRD-V2 §9.1).
  classification  text check (classification in ('tech', 'non_tech')),

  -- OD evidence is transient; certificates are permanent. Read by the purge
  -- trigger rather than hardcoded per type.
  retain_attachments_after_close boolean not null default false,

  is_active       boolean not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
create index request_categories_parent on request_categories (parent_id);

-- Suggested first recipients for a category, resolved to real people by tag
-- at request time. The picker, not a fixed workflow graph.
create table category_first_hop_options (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references request_categories(id) on delete cascade,
  tag_id      uuid not null references tags(id),
  label       text not null,
  sort_order  int not null default 0,
  unique (category_id, tag_id)
);

-- ============================================================
-- PARTICIPATION — approve, notify, or skip (D-3)
-- ============================================================

create table category_level_roles (
  category_id   uuid not null references request_categories(id) on delete cascade,
  level_id      uuid not null references priority_levels(id),
  participation text not null check (participation in ('approves', 'notified', 'skipped')),
  sort_order    int not null default 0,
  primary key (category_id, level_id)
);

comment on table category_level_roles is
  'Per-category, per-level participation. A level with no row here does not '
  'take part in that category at all. A level configured as approves but with '
  'no holder in the requester''s scope is treated as skipped rather than '
  'stalling the ticket — the wizard permits levels with no tag attached, so '
  'an unfilled level is a normal state, not an error (PRD-V2 §4).';

-- ============================================================
-- CHECKS — flat, per level, no cross-check dependencies (D-5)
-- ============================================================

create table level_checks (
  id          uuid primary key default gen_random_uuid(),
  level_id    uuid not null references priority_levels(id),
  category_id uuid references request_categories(id),   -- null = every category
  label       text not null,
  -- 'manual'                     — a human ticks it, using judgement
  -- 'all_participants_consented' — derived from request_participants, not
  --                                re-entered; parent consent already lives
  --                                there and must not get a second source of
  --                                truth (PRD-V2 §5)
  -- 'field_present'              — a named custom field has a value
  check_type  text not null,
  field_key   text,                                     -- for 'field_present'
  scope       text not null default 'request' check (scope in ('request', 'per_participant')),
  is_required boolean not null default true,
  sort_order  int not null default 0
);

-- request_check_results is declared further down, after `requests` and
-- `request_participants` exist — it has foreign keys to both.

-- ============================================================
-- VISIBILITY RULES (PRD-V2 §6)
-- ============================================================
-- Default, expressed in can_see_request() rather than here: you see tickets
-- from ranks below you within your subtree. This table only records the
-- exceptions — peers seeing each other, or findable-but-not-listed.

create table level_visibility_rules (
  viewer_level_id uuid not null references priority_levels(id),
  target_level_id uuid not null references priority_levels(id),
  scope           text not null default 'same_subtree' check (scope in ('same_subtree', 'any')),
  mode            text not null default 'none' check (mode in ('none', 'search_only', 'list')),
  primary key (viewer_level_id, target_level_id, scope)
);

comment on column level_visibility_rules.mode is
  'search_only means the ticket is reachable by direct search but never '
  'appears in a list — so search results and list queries deliberately stop '
  'returning the same set, and both paths need testing.';

-- ============================================================
-- CUSTOM FIELDS
-- ============================================================

create table field_definitions (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references request_categories(id) on delete cascade,
  field_key   text not null,
  label       text not null,
  field_type  text not null,       -- 'text' | 'number' | 'date' | 'select' | 'file'
  options     jsonb,
  is_required boolean not null default false,
  sort_order  int not null default 0,
  unique (category_id, field_key)
);

-- ============================================================
-- REQUESTS
-- ============================================================

create type request_status as enum (
  'draft', 'submitted', 'in_review', 'changes_requested',
  'approved', 'rejected', 'reviewed', 'closed'
);

create table requests (
  id               uuid primary key default gen_random_uuid(),
  reference_number text not null unique,
  category_id      uuid not null references request_categories(id),

  -- Copied at creation and never updated. A category's mode changing later
  -- must not retroactively alter tickets already in flight.
  decision_mode    decision_mode not null,

  requested_by     uuid not null references profiles(id),
  -- The capacity the requester filed in. A club coordinator filing for an
  -- event is a different act from the same person filing as a mentor.
  requested_as     uuid references role_assignments(id),

  title            text not null,
  body             text,
  status           request_status not null default 'draft',

  current_holder   uuid references profiles(id),
  current_level_id uuid references priority_levels(id),

  -- Denormalised from the requester at submit time so a ticket stays
  -- scoped correctly even if the person later moves department.
  org_unit_id      uuid references org_units(id),

  submitted_at     timestamptz,
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger requests_updated_at before update on requests
  for each row execute function set_updated_at();

create index requests_holder on requests (current_holder) where status not in ('closed', 'draft');
create index requests_requester on requests (requested_by);
create index requests_org on requests (org_unit_id);

-- Append-only trail of every hop. `acted_as` is what makes the trail able to
-- answer "in what capacity?", which is the entire point of D-1.
create table request_assignment_history (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references requests(id) on delete cascade,
  from_user   uuid references profiles(id),
  to_user     uuid references profiles(id),
  acted_by    uuid references profiles(id),
  acted_as    uuid references role_assignments(id),
  action      text not null,
  note        text,
  created_at  timestamptz not null default now()
);
create index rah_request on request_assignment_history (request_id, created_at);

-- Notified levels land here. Being a watcher is explicitly not being a
-- blocker: the default inbox shows only what is awaiting your decision, and
-- watched tickets sit behind "show all" (PRD-V2 §7.1).
create table request_watchers (
  request_id uuid not null references requests(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  reason     text not null,
  added_at   timestamptz not null default now(),
  primary key (request_id, user_id)
);

-- ============================================================
-- PARTICIPANTS — group requests and parent consent
-- ============================================================

create table request_participants (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references requests(id) on delete cascade,
  member_id   uuid not null references profiles(id),

  -- Snapshotted so a historical ticket still reads correctly after a
  -- register number is corrected or a name changes.
  snapshot_name   text not null,
  snapshot_reg_no text not null,
  is_leader       boolean not null default false,

  -- A student added to someone else's group request accepts or declines
  -- being on it. Peer consent, distinct from approval (PRD-V2 §6).
  acceptance_status text not null default 'pending'
                    check (acceptance_status in ('pending', 'accepted', 'declined')),
  accepted_at       timestamptz,

  -- Parent consent is a verified record, never a file: the mentor phones,
  -- confirms, and fills this in. There is no undertaking document.
  parent_consent_verified    boolean not null default false,
  parent_consent_verified_by uuid references profiles(id),
  parent_consent_verified_at timestamptz,
  parent_name                text,
  parent_contact             text,
  transport_mode             text,
  consent_note               text,

  unique (request_id, member_id)
);

-- Declared here rather than beside level_checks because it needs both
-- `requests` and `request_participants` to exist first.
create table request_check_results (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references requests(id) on delete cascade,
  check_id       uuid not null references level_checks(id) on delete cascade,
  -- Null for request-scoped checks. Set for per_participant ones — the
  -- mentor ticks parent consent per student, not once per ticket.
  participant_id uuid references request_participants(id) on delete cascade,
  result         text not null check (result in ('passed', 'failed', 'na')),
  acted_by       uuid references profiles(id),
  acted_as       uuid references role_assignments(id),   -- which capacity (D-1)
  note           text,
  acted_at       timestamptz not null default now()
);

-- One result per check per participant; one per check when request-scoped.
-- Two partial indexes rather than a composite primary key, because a null
-- participant_id would not be deduplicated by a plain unique constraint.
create unique index rcr_per_participant on request_check_results (request_id, check_id, participant_id)
  where participant_id is not null;
create unique index rcr_per_request on request_check_results (request_id, check_id)
  where participant_id is null;

-- ============================================================
-- COMMENTS
-- ============================================================

create table request_comments (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  author_id  uuid not null references profiles(id),
  acted_as   uuid references role_assignments(id),
  visibility text not null default 'public' check (visibility in ('public', 'internal')),
  body       text not null,
  created_at timestamptz not null default now()
);
create index request_comments_request on request_comments (request_id, created_at);

-- Structural, not a read policy: a base-level user cannot author an internal
-- note at all, so there is no path where one exists and is merely hidden.
create or replace function block_base_level_internal_comment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.visibility = 'internal' and is_lowest_level() then
    raise exception 'Base-level users cannot write internal notes.';
  end if;
  return new;
end;
$$;

create trigger comments_block_base_internal before insert on request_comments
  for each row execute function block_base_level_internal_comment();

-- ============================================================
-- ATTACHMENTS
-- ============================================================

create table request_attachments (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references requests(id) on delete cascade,
  uploaded_by uuid not null references profiles(id),
  object_key  text not null,
  file_name   text not null,
  mime_type   text not null,
  size_bytes  bigint not null,
  -- Set by the purge trigger when a request closes, based on the category's
  -- retention flag. Certificates never get one.
  purge_after timestamptz,
  created_at  timestamptz not null default now()
);

create index attachments_pending_purge on request_attachments (purge_after)
  where purge_after is not null;

-- Marks rows only. Deleting the object from Garage and removing the row is
-- an external job reading attachments_pending_purge — still unbuilt, and
-- tracked as a known gap rather than left to look finished (SECURITY.md R-24).
create or replace function schedule_attachment_purge()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_retain boolean;
begin
  if new.status = 'closed' and coalesce(old.status, 'draft') <> 'closed' then
    select rc.retain_attachments_after_close into v_retain
    from request_categories rc where rc.id = new.category_id;

    if not coalesce(v_retain, false) then
      update request_attachments
      set purge_after = now() + interval '7 days'
      where request_id = new.id and purge_after is null;
    end if;
  end if;
  return new;
end;
$$;

create trigger requests_schedule_purge after update of status on requests
  for each row execute function schedule_attachment_purge();

-- ============================================================
-- SIGNATURES
-- ============================================================

create table signature_assets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  object_key text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index one_active_signature_per_user on signature_assets (user_id) where is_active;

create table signatures (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references requests(id) on delete cascade,
  signer_id    uuid not null references profiles(id),
  acted_as     uuid references role_assignments(id),
  level_id     uuid references priority_levels(id),
  decision     text not null check (decision in ('approved', 'rejected', 'changes_requested')),
  -- Computed server-side from the row as stored. A client-supplied hash
  -- proves nothing about what was actually signed.
  state_hash   text not null,
  note         text,
  created_at   timestamptz not null default now()
);
create index signatures_request on signatures (request_id, created_at);

-- Append-only, enforced by trigger rather than by withheld GRANTs — a
-- careless GRANT later cannot re-open it; only dropping the trigger can,
-- which the runtime role has no permission to do.
create or replace function signatures_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'signatures are append-only';
end;
$$;

create trigger signatures_no_update before update on signatures
  for each row execute function signatures_immutable();
create trigger signatures_no_delete before delete on signatures
  for each row execute function signatures_immutable();

-- The row is the source of truth; the PDF is a rendering of it that can be
-- regenerated identically at any time, which is why cached_object_key is
-- disposable.
create table generated_documents (
  id                uuid primary key default gen_random_uuid(),
  request_id        uuid not null references requests(id) on delete cascade,
  doc_type          text not null,
  reference_code    text not null unique,
  state_hash        text not null,
  signature_ids     uuid[] not null default '{}',
  cached_object_key text,
  generated_by      uuid references profiles(id),
  created_at        timestamptz not null default now()
);
