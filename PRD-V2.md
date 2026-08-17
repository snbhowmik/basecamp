# PRD — Basecamp v2.0.0

**Status:** Design — iterating, not locked
**Last Updated:** 2026-08-18
**Supersedes:** nothing yet. Read alongside PRD.md (v1.0.0), which stays accurate for everything this document doesn't change.

> **This document is a design draft, not a record of what's built.** Unlike ARCH.md — which describes what's actually in `supabase/migrations/` — everything here is proposed. Where this and the code disagree, the code is right and this is still a plan.

---

## 1. What Changes, In One Sentence

v1 assumed **one person, one level, one job, in a two-level org, where every level in the path must approve**. v2 assumes **one person can hold several time-boxed roles at once, in an org structure with faculty/programme/batch/section depth, where a level may approve, may merely be informed, or may be skipped entirely — configured per request category.**

The domain framing completes the shift PRD.md already committed to on paper: this is a **ticketing platform**, and "OD requests for a university" is one configuration of it.

---

## 2. Decisions Locked

| # | Decision | Rationale |
|---|---|---|
| D-1 | **Multi-role via explicit context switch.** A user with >1 role assignment picks "acting as X" before acting; the capacity is recorded on the signature and assignment history. | Otherwise the audit trail can't distinguish whether a faculty club coordinator approved as coordinator or as academic mentor. Different authority paths; the record must say which was used. |
| D-2 | **Generalize education naming now**, while the database holds exactly one account. `student_profiles` → `member_profiles`, `is_base_level()` → `is_lowest_level()`. | Breaking renames are nearly free today and permanently expensive after real registrations. There is no production data to migrate. |
| D-3 | **A level's participation is per-category: `approves`, `notified`, or `skipped`.** | The techfest case: a student informs their mentor, the mentor does nothing, the HOD does nothing, the ticket routes to the event coordinator. The mentor is still on the record as informed, so it is not a silent bypass. |
| D-4 | **No external (accountless) approvers in v2.** | Introduced from the IT-company example, but nobody in the SRMIST flow approves without a login. It would add the weakest authorization path in the system — a bearer token in a URL, no MFA, no proof of who clicked — to serve zero current users. Revisit in v3 against a real external party. |
| D-5 | **Level checks have no cross-check dependencies.** Each level has a flat list of checks; all required ones must be satisfied before the ticket moves on. | The real flow is sequential — Mentor verifies per student, HOD reviews and signs — and sequence already falls out of rank ordering. Conditional logic across checks would require an expression format, an evaluator, a builder UI, and a debugging story for stuck tickets. That's a rule engine. Not needed. |
| D-6 | **The setup wizard stays minimal; the org structure is built in the admin UI.** The wizard creates only the captain, MFA, allowed domains, and the initial levels/tags/first category — enough to *have an admin at all*. Faculties, programmes, batches, and sections are ordinary admin work afterward. | Keeps `0003_wizard_rls.sql`'s bootstrap window — the riskiest RLS in the codebase, where writes are permitted before any admin exists — as narrow as it is today. Everything built after the captain exists runs under normal RLS with a real `auth.uid()` behind it. |

---

## 3. The Two Breaking Schema Changes

Both are breaking, both belong in the same migration, and both are cheap *only right now*.

### 3.1 `user_levels` → `role_assignments`

Today ([`0001_schema.sql:95`](supabase/migrations/0001_schema.sql)):

```sql
create table user_levels (
  user_id uuid primary key references profiles(id)   -- one level per user, forever
  ...
);
```

The primary key on `user_id` alone makes multi-role structurally impossible. Replacement:

```sql
create table role_assignments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  level_id     uuid not null references priority_levels(id),
  org_unit_id  uuid references org_units(id),      -- scope; null = institute-wide
  role_kind    text not null default 'academic',   -- 'academic' | 'club' | 'event' | ...
  is_primary   boolean not null default false,     -- default context on login
  valid_from   timestamptz not null default now(),
  valid_until  timestamptz,                        -- null = open-ended
  assigned_by  uuid references profiles(id),
  assigned_at  timestamptz not null default now(),
  unique (user_id, level_id, org_unit_id, role_kind)
);
```

`valid_until` exists because of the techfest case — event roles are created for one event and must expire. A techfest coordinator should not still hold that authority next year, and expiry should be data, not a cleanup task someone remembers to run.

**Consequence for the helper functions.** `my_rank()` currently returns one scalar and is called by nearly every RLS policy in `0002_functions_and_rls.sql`. It splits in two:

- `my_best_rank()` — most senior rank held anywhere, for "can this person see the admin area at all"
- `my_rank_in(p_org_unit uuid)` — rank within a subtree, for anything ticket-scoped

Both must filter on `valid_from`/`valid_until`. Every existing policy has to be audited for which one it meant. **This is the highest-risk part of v2** — a policy that keeps calling a rank function with the wrong scope is an authorization hole that RLS will enforce confidently and wrongly. Budget a dedicated review pass; it is not a mechanical rename.

### 3.2 `departments` + `classes` → a four-level org structure

A real student placement string —

```
CSE-SC 2024 FT, Faculty of E&T - TRY for Cyber Security 2024-2028
```

— encodes at least six independent dimensions:

| Fragment | Dimension |
|---|---|
| Faculty of E&T | faculty / school |
| TRY | campus |
| CSE-SC | programme code |
| Cyber Security | specialization |
| FT | mode (full-time / part-time) |
| 2024 · 2024-2028 | admission year, batch span |

Stored as a string, every query becomes text parsing. Decomposed:

```
org_units   Faculty of E&T → CSE-SC (programme)    ← stable; HOD sits here
batches     (programme, 2024, 2028, mode='FT')     ← rolls over yearly
sections    (batch, 'A', roll_from, roll_to)       ← mentors sit here
```

```sql
create table org_units (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid references org_units(id),
  unit_type  text not null,        -- 'faculty' | 'programme'
  name       text not null,
  code       text not null,
  campus     text,
  tag_id     uuid references tags(id),
  is_active  boolean not null default true,
  unique (parent_id, code)
);
```

**Batch is a dimension, not a tree level.** If batches became org-tree nodes, the tree would grow an entire new subtree every admission year and every HOD would need reassigning annually. Instead the tree holds only what's stable (faculty, programme) and batches hang off programme. The existing `classes` table is already doing batch duty ([`0006:341`](supabase/migrations/0006_requests_and_org.sql)) — this is largely renaming it to `batches`, adding `sections` beneath it, and adding `campus`/`mode`, which have nowhere to live today.

Sections are batch-scoped by design: 2024's "Cyber Security - A" is a different group of humans from 2025's.

Add the relationship predicates, in the style ARCH.md §4 mandates — every relationship check is one `security definer` function, reused, never inlined:

```sql
in_org_subtree(p_ancestor uuid, p_descendant uuid) returns boolean
has_tag_or_ancestor(p_tag_code text) returns boolean
```

### 3.3 Clubs Are Not a Separate Tree

An earlier draft modelled clubs as a parallel forest on the assumption their membership crossed departments. That was wrong: clubs are constituted department-wise and need no tag hierarchy of their own. A club coordinator is a `role_assignment` with `role_kind = 'club'`, scoped to a programme org unit. No second tree.

---

## 4. Level Participation — Approve, Notify, or Skip

The mechanism for "informed but not gating" already exists and is merely hardcoded. `add_mandatory_watchers()` ([`0006:27`](supabase/migrations/0006_requests_and_org.sql)) inserts the mentor and HOD into `request_watchers` with `reason = 'mandatory_mentor'` / `'mandatory_hod'` on submit. They see the ticket, they're on the record, and they are not in the approval path. v2 makes that configurable per category rather than unconditional:

```sql
create table category_level_roles (
  category_id   uuid not null references request_categories(id),
  level_id      uuid not null references priority_levels(id),
  participation text not null,   -- 'approves' | 'notified' | 'skipped'
  primary key (category_id, level_id)
);
```

The techfest OD category becomes: mentor → `notified`, HOD → `notified`, event coordinator → `approves`. The student submits, mentor and HOD get it in their feed and on the audit trail, neither has to act, and it routes to whoever actually decides.

This is deliberately a rule *bend*, recorded rather than hidden — the mentor was informed, and the trail proves it.

**Unassigned levels skip.** A level with no holder in the requester's scope must be treated as `skipped`, not left to stall the ticket. The wizard allows creating levels with no tag attached (filled in later), so this is a normal state, not an error.

---

## 5. Level Checks

Each level has a flat list of checks that must be satisfied before a ticket leaves that level. No dependencies between checks (D-5).

```sql
create table level_checks (
  id          uuid primary key default gen_random_uuid(),
  level_id    uuid not null references priority_levels(id),
  category_id uuid references request_categories(id),  -- null = all categories
  label       text not null,
  check_type  text not null,     -- 'manual' | 'field_present' | 'all_participants_consented' | ...
  scope       text not null default 'request',        -- 'request' | 'per_participant'
  is_required boolean not null default true,
  sort_order  int not null default 0
);

create table request_check_results (
  request_id     uuid not null references requests(id) on delete cascade,
  check_id       uuid not null references level_checks(id),
  participant_id uuid references request_participants(id),  -- null for request-scoped
  result         text not null,     -- 'passed' | 'failed' | 'na'
  acted_by       uuid references profiles(id),
  acted_as       uuid references role_assignments(id),      -- D-1: which capacity
  note           text,
  acted_at       timestamptz not null default now()
);
```

**Some checks are derived, not ticked.** Parent consent is already stored per participant in `request_participants` (`parent_consent_verified`, `parent_consent_verified_by`) — the mentor calls each student's parent and fills it in. A check of type `all_participants_consented` reads that existing data rather than duplicating it as a second source of truth. Only genuinely judgment-based checks are `manual`.

---

## 6. Visibility — One Default Rule, Config for Exceptions

**Default:** you see tickets from ranks below you within your org subtree. Everything else is configuration:

```sql
create table level_visibility_rules (
  viewer_level_id uuid not null references priority_levels(id),
  target_level_id uuid not null references priority_levels(id),
  scope           text not null default 'same_subtree',  -- 'same_subtree' | 'any'
  mode            text not null default 'none',          -- 'none' | 'search_only' | 'list'
  primary key (viewer_level_id, target_level_id, scope)
);
```

| Scenario | How it's expressed |
|---|---|
| Student must accept a group participation | `request_participants.acceptance_status` — peer consent, not visibility |
| Club coordinator files on behalf of attendees | `role_assignment` with `role_kind='club'` |
| A level sees peers' tickets | `viewer_level = target_level`, `mode='list'` |
| Findable but not listed | `mode='search_only'` |

`can_see_request()` ([`0006:73`](supabase/migrations/0006_requests_and_org.sql)) already centralizes this and is the single function to extend. `search_only` is the one genuinely new concept, since it means search results and list queries stop returning the same set — worth its own test.

---

## 7. Dashboards — One Shell, One Rule

**Single dashboard, stable sidebar, context switcher at the top**, shown only to users holding more than one active assignment. Per-role dashboards are not built; the sidebar's *contents* follow the active context.

```
┌────────────────────────────────────────────┐
│  Acting as: [Mentor — CSE-SC A ▾]          │
├──────────┬─────────────────────────────────┤
│ Inbox    │                                 │
│ Tickets  │   widgets scoped to             │
│ Create   │   the active context            │
│ Analytics│                                 │
│ Admin    │                                 │
└──────────┴─────────────────────────────────┘
```

**The analytics rule:** *you see aggregate analytics for everyone strictly below your rank, within your org subtree.*

| Context | Falls out of the rule as |
|---|---|
| Dean | whole faculty, programme breakdown |
| HOD | one programme, batch/section breakdown, trends + "best wins" panel |
| Mentor | their sections, per-student |
| Club coordinator | club members, event participation |
| Student | nobody below them ⇒ own stats only: tickets submitted, hackathons, conferences, tech vs non-tech |

The "recent trends / best wins in the side panel, click to expand into project info" is the same query at a different aggregation — a drill-down, not a separate feature.

**Deliberate exclusion:** a student sees only their own numbers, never a peer comparison. This is a privacy decision, not an oversight — leaderboards across students turn a request tracker into a ranking instrument nobody consented to.

### 7.1 The Inbox Shows Only What Is Actionable Now

A mentor and HOD are added as watchers on **every** request from their students (`add_mandatory_watchers()`, unconditional). At any real volume that buries the handful of tickets actually waiting on them under everything merely passing through.

So the default inbox is **"awaiting my decision, right now"** — tickets where the acting context is the current required approver and nothing upstream is still pending. Everything else the user can legitimately see sits behind an explicit **Show all** toggle.

| View | Contains |
|---|---|
| **Default** | Ticket is at my level, in my acting context, and I am what's blocking it |
| **Show all** | Everything `can_see_request()` permits — watching, already decided, downstream, informational |

Three things this preserves, all of which matter:

- A student still picks the **first hop** themselves (`list_first_hop_candidates()`, unchanged) — this changes what a queue *displays*, never where a ticket goes.
- Mentor and HOD are still watchers on everything, still on the audit trail, still able to find any ticket. Hidden by default is not the same as not received.
- `notified`-participation levels (D-3) never appear in the default inbox by construction, since they are never what's blocking. The techfest case produces no queue entry for the mentor at all — which is the entire point of that flow.

This is a query and a toggle, not new schema.

---

## 8. Register Numbers — Identity and Search Key

A register number already encodes the batch, so sections don't need a separate roll-range concept — it's derived:

```
RA24 11030050 XXX     Cyber Security, 2024 FT
RA23 11030050 XXX     Cyber Security, 2023 FT
RA24 11026050 XXX     AIML,           2024 FT
     └ programme ┘    └ serial ┘
  └ admission year
```

```sql
alter table batches
  add column reg_no_prefix     text,   -- 'RA2411030050'
  add column reg_no_serial_len int;    -- 3

create table sections (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references batches(id),
  name        text not null,
  serial_from int not null,
  serial_to   int not null,
  tag_id      uuid references tags(id),
  unique (batch_id, name)
);
```

**The prefix is stored as an opaque string, not decomposed.** `11030050` clearly distinguishes Cyber from AIML's `11026050`, but where the programme code ends and any fixed padding begins isn't determinable from the examples on hand — and doesn't need to be. Prefix-match plus serial-parse delivers both features below without encoding a guess that breaks the first time a new programme numbers differently.

This buys two things:

**8.1 The register number is the identity key, and it is never reused.** `student_profiles.reg_no` is already `not null unique` ([`0001:125`](supabase/migrations/0001_schema.sql)) — uniqueness is enforced today and needs no change. What follows from it is a UI commitment, not a schema one: **register number is the primary way to find a student**, ahead of name or email. Name search is ambiguous at 8,000 students and email is not what anyone actually quotes in conversation. Every place a person is looked up — invite, roster, forward-target search, participant picker — should match on `reg_no` first and rank exact prefix matches above everything else.

Note the current placeholder: a student-shaped invite created without a register number gets `PENDING-<uuid8>` and `is_complete = false` ([`0004:164`](supabase/migrations/0004_account_provisioning.sql)). Those rows are unsearchable by the thing that matters, so completing them should be surfaced as an admin chore, not left silent.

**8.2 The prefix enables validation at signup.** Today a student picks their own department from a dropdown and nothing verifies the claim — `0005_public_registration.sql` notes the only real identity check is owning the inbox. With `reg_no_prefix` on the batch, `RA2411030050042` can be checked against the batch being claimed, so a student cannot register into Cyber Security with an AIML register number. This also catches ordinary typos at the point of entry, where they're cheap, rather than after a request is already in flight.

Sections still carry serial ranges so a batch can be split across mentors, but assignment is a convenience, not the point of the format — and any derived assignment must be overridable per student (§8.3).

**8.3 Open — needed before validation ships.** A wrong assumption here rejects real students at signup:

- Is the serial always 3 digits, and does it restart at 001 per batch?
- Do lateral-entry and transfer students get register numbers in this same format? If not, validation needs a manual-override path rather than a hard reject.

---

---

## 9. Person Cards — Inline Info on a Ticket

Every person named on a ticket (requester, each participant, each approver) carries an ⓘ affordance. Two tiers, split on privacy rather than on convenience.

### 9.1 Tier 1 — the hover/click card

Name, register number, programme and batch, and **OD counts split tech / non-tech**. Visible to anyone who can already see the request, i.e. gated by the existing `can_see_request()`. Nothing here isn't already implied by being on the ticket together.

This is what forces **Q-1** to be answered, and answers it: the tech/non-tech split has to live on `request_categories`, because that's what's being counted.

```sql
alter table request_categories
  add column classification text;   -- 'tech' | 'non_tech' | null
```

Clubs may carry a default to pre-fill the field when a coordinator raises a request, but the counted value is the category's — a tech club can run a non-tech event and the count must follow the event.

### 9.2 Tier 2 — the full profile

CGPA, achievement history, full request history. **Not visible to peers.**

```sql
alter table student_profiles
  add column cgpa numeric(4,2),
  add column cgpa_updated_at timestamptz;
```

The visibility line matters and should not be drawn by convenience. A student who is a co-participant on a group request can see the Tier 1 card of the person who invited them — that's unavoidable and fine. They must **not** see that person's CGPA. So:

| Viewer | Tier 1 | Tier 2 |
|---|---|---|
| Self | ✅ | ✅ |
| Peer on the same request | ✅ | ❌ |
| Staff outranking them in their subtree (mentor, HOD, dean) | ✅ | ✅ |
| Staff elsewhere in the org | ✅ | ❌ |

Both tiers are `security definer` RPCs with the authorization re-checked inside, following `create_and_submit_request()`'s pattern ([NOTE.md](NOTE.md) 2026-08-11) — SECURITY DEFINER bypasses the RLS that would otherwise enforce this, so the check has to be explicit and in one place:

```sql
get_member_card(p_user_id uuid)      -- tier 1, gated by shared-request visibility
get_member_profile(p_user_id uuid)   -- tier 2, gated by self-or-outranking-staff
```

Achievements need no new table — they're already `requests` of a `log_only` type (ARCH.md §3.3), so the profile reads existing rows rather than duplicating a record that would then need keeping in sync.

### 9.3 CGPA Lifecycle — Mentor-Verified, Then Locked

This replaces a Google Form. Today the mentor collects a screenshot of the student portal plus the claimed CGPA through a form, then transcribes it. The portal absorbs that loop directly.

```sql
alter table student_profiles
  add column cgpa              numeric(4,2),
  add column cgpa_proof_key    text,          -- screenshot in Garage
  add column cgpa_verified_by  uuid references profiles(id),
  add column cgpa_verified_at  timestamptz,
  add column cgpa_updated_at   timestamptz;

create table cgpa_windows (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,          -- 'Semester 4 results'
  opens_at   timestamptz not null,
  closes_at  timestamptz not null,
  org_unit_id uuid references org_units(id),   -- null = institute-wide
  created_by uuid references profiles(id)
);
```

**The rules, in order of precedence:**

1. **Collection windows.** A student may submit or update their own CGPA + proof only while a window covering their org unit is open. Outside a window, the field is read-only to them. This mirrors how the real process already works — CGPA is collected after results, not continuously.
2. **Verification locks it.** Once a mentor sets `cgpa_verified_by`, the student can no longer change the value at all, window open or not. Changing it afterward requires the mentor, the HOD, or anyone outranking them. A student who believes a verified figure is wrong asks a human; there is no self-service path around a verification.
3. **Mentors may edit any time.** A mentor correcting one student's CGPA outside a window is a normal, expected action, not an exception requiring a window to be opened.
4. **Unverified means unverified in the UI.** Before verification the number displays as self-reported with its `cgpa_updated_at` age. An approver reading a person card must be able to tell at a glance whether they're looking at a checked figure or a claim — otherwise an unverified number silently influences decisions (§9.2 shows CGPA to approving staff).

The proof screenshot is an ordinary attachment and inherits the retention model in ARCH.md §3.6 — it is evidence for a verification, not a permanent record, and should carry `purge_after` once verified rather than accumulating one image per student per semester forever.

---

## 10. Write Scope Follows Role Kind

An academic role changes academic things; a non-academic role does not, and vice versa. This is a **write** rule, distinct from the visibility rules in §6 and from rank.

A faculty member who is both a Mentor (academic) and a Robotics Club coordinator (club) must not be able to edit a student's CGPA or section while acting as the club coordinator — even though they legitimately hold that power under their other hat. Rank alone would permit it; `role_kind` is what forbids it.

This is what D-1's context switch is *for*. Having picked "acting as club coordinator," the acting capacity is already recorded on every write (`acted_as`), so the same value gates what the write may touch:

| Data | Writable by |
|---|---|
| CGPA, section/batch assignment, academic verification | `role_kind = 'academic'` only |
| Club membership, event roles, club request categories | `role_kind = 'club'` / `'event'` only |
| Tickets, comments, decisions | any kind, subject to the normal rank and participation rules |

Enforced the same way everything else is — one `security definer` predicate, reused, never inlined:

```sql
acting_kind_is(p_kind text) returns boolean
```

**Note the interaction with §9.3.** "A mentor may edit CGPA any time" means *a mentor acting as a mentor*. The same person acting as a club coordinator cannot, and the audit trail will show which capacity was used. Without this, D-1 records the capacity but nothing enforces it — the record would document a violation rather than prevent it.

---

## 11. Identity and People Search

### 11.1 Staff have no profile row today

`student_profiles` exists; there is no staff equivalent, so a faculty member has a `profiles` row and nothing else. Every faculty member has a **FET ID**, and it needs to live somewhere and be searchable.

Rather than a parallel `staff_profiles` table, fold both into the `member_profiles` rename already committed in D-2 — because search has to span both populations and a single table makes that one query rather than a union that has to stay in sync:

```sql
-- student_profiles → member_profiles (D-2)
alter table member_profiles
  add column member_type text not null default 'student',  -- 'student' | 'staff'
  add column fet_id      text;

create unique index member_profiles_reg_no on member_profiles (upper(reg_no)) where reg_no is not null;
create unique index member_profiles_fet_id on member_profiles (upper(fet_id)) where fet_id is not null;
```

`reg_no` becomes nullable (staff don't have one) with the uniqueness moved to a partial index, preserving today's guarantee for the rows that have one. Shape is enforced by a check constraint per `member_type` rather than by convention.

### 11.2 One search, three ways in

Students look up faculty; faculty look up students. Both need the same three entry points, so it's one RPC, not two:

```sql
search_people(
  p_query       text,      -- reg no, FET ID, or name
  p_member_type text,      -- optional filter
  p_org_unit_id uuid       -- optional: school, or school → programme
) returns table (...)
```

**Ranking matters more than matching here.** An exact `reg_no` or `fet_id` match ranks above a prefix match, which ranks above a name match. At 8,000 students a name query returns a wall of results; an ID query should return one row at the top, every time. This is the concrete form of §8.1's commitment.

The org-unit filter is the drill-down: pick a school, then optionally a programme, and search within it. That's the same tree from §3.2, so it needs no extra structure — `in_org_subtree()` already expresses it.

Search results are Tier 1 person cards (§9.1) and obey the same rule: identity and counts, never CGPA.

---

## 12. Remaining Open Questions

*(Q-1 resolved in §9.1. Q-2 resolved by D-5. Q-3 resolved by D-4. Q-4 resolved in §8. Q-5 resolved by D-6. Q-6 resolved in §4. CGPA ownership resolved in §9.3.)*

- **§8.3** — register-number serial length, restart behaviour, and lateral-entry format. Gates signup validation; a wrong assumption rejects real students.
- **§11.1** — is the FET ID format fixed and validatable, the way register numbers are? If so it gets the same prefix check; if it's free-form, uniqueness is all that can be enforced.
- **§9.3** — do CGPA collection windows apply per programme, per batch, or institute-wide? `cgpa_windows.org_unit_id` currently allows any of the three, which may be more flexibility than the real process needs.

---

## 13. Suggested Build Order

Ordered by what unblocks what, not by visible progress. The first two produce nothing a user can see and must still come first.

1. **`0009_org_and_roles.sql`** — `org_units`, `batches` (+ `reg_no_prefix`), `sections`, `role_assignments`, generic renames (D-2), tree functions, reg-number derivation (§8). Breaking; do it while there's one account. *(`0008` is invite email delivery, already built.)*
2. **Audit every RLS policy** for `my_rank()` → `my_best_rank()` / `my_rank_in()`, including validity-window filtering. Highest-risk step in v2 (§3.1); review as its own pass, not folded into step 1's diff.
3. **Context switcher + `acted_as` plumbing** — D-1 is worthless if the capacity isn't recorded at the point of action.
4. **`0010_participation_and_checks.sql`** — `category_level_roles`, `level_checks`, forward-gating, skip semantics.
5. **`0011_visibility_rules.sql`** + `search_only` in `can_see_request()`.
6. **Analytics** — last, because it reads everything above and is the cheapest thing to redo.

---

## 14. What This Does Not Change

- RLS remains the real authorization boundary. Nothing here moves enforcement into the frontend.
- No BFF, no custom API server. Cutting external approvals (D-4) removes the one thing that was pushing toward a server-side component.
- Priority levels + tags remain the model. v2 makes them multi-assignable, time-boxed, and tree-scoped; it does not introduce a fixed role enum.
- "No Fixture Data" still holds — v2 adds more configuration surface, meaning *more* things the captain creates by hand, not seeded defaults.
