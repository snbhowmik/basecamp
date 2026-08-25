# ARCH — Architecture & Data Design

**Basecamp 3.00.000** · **Current as of commit `16da814`, 2026-08-25**
Describes `supabase/schema-v2/0001`–`0029`, all applied. Where this and the
migration files disagree, **the files are right** — check
`basecamp_meta.schema_migrations` for what is actually on the instance.

> **Which document to read.** This one is the shape of the live schema and why
> it is shaped that way. [HANDOFF.md](HANDOFF.md) is what is proven versus
> merely built, and the known gaps. [PRD-V2.md](PRD-V2.md) is intent and open
> product questions. Nothing planned-but-unbuilt belongs in this file; that is
> how the previous version rotted into describing a system that did not exist.

---

## 1. Why Self-Hosted Supabase

`auth.uid()` is the whole point. Earlier designs moved to a custom VPS +
Keycloak + hand-built authorization engine, which meant no per-user JWT ever
reached Postgres, and every RLS policy had to be replaced with a two-layer
system built from scratch — the highest-risk, highest-effort piece of that
design.

Self-hosted Supabase is the same open-source stack in Docker Compose on your
own VPS:

- **Self-hosted** — own infrastructure, own control.
- **`auth.uid()` works** — GoTrue issues the JWT, PostgREST forwards it,
  Postgres verifies it. RLS is a real, enforced boundary (`0003_rls.sql`).
- **MFA is native** — TOTP enrolment and `aal1`/`aal2` claims are built in.
- **No custom API server** — PostgREST generates the REST API from the schema,
  and every write goes through a `security definer` RPC (§4.4).

---

## 2. Topology

```
Cloudflare Tunnel
        │
        ▼
VPS — docker-compose.yml (11 services)
   ┌──────────────────────────────────────────────┐
   │ kong      — the only published port,          │
   │             bound to 127.0.0.1:8000           │
   │ frontend  — nginx serving ./app/dist          │
   │ auth      — GoTrue: signup, TOTP, JWTs        │
   │ rest      — PostgREST (PGRST_DB_PRE_REQUEST)  │
   │ realtime  — live subscriptions                │
   │ storage   — storage-api over Garage           │
   │ garage    — self-hosted S3-compatible object  │
   │ db        — Postgres, RLS-enforced            │
   │ meta      — schema introspection for studio   │
   │ studio    — admin DB browser, internal only   │
   │ mailer    — invite email worker               │
   └──────────────────────────────────────────────┘
```

The SPA is **not** on Cloudflare Pages. `docker-compose.yml` bind-mounts
`./app/dist:/usr/share/nginx/html:ro`, which makes **`npm run build` the
deploy** — there is no separate publish step and no staging. `nginx/frontend.conf`
supplies the SPA fallback so `/invite/<token>` resolves on a cold load, because
Kong routes `/` to the frontend as a catch-all.

Only `kong` publishes a port. Everything else sits on the internal Docker
network with no published port at all.

---

## 3. Database Schema

Thirty-five tables. Grouped by what they are for rather than by migration.

### 3.1 Identity

`profiles` mirrors `auth.users` (created by `handle_new_user()`), and
`member_profiles` carries the academic record — `reg_no`, `member_type`
(student or staff), org unit, batch, section, CGPA. Students and staff share
one table; v1's `student_profiles` is gone.

`profiles` is readable by any authenticated user, because you have to be able
to address a ticket to someone. `member_profiles` is not: the column-level
trigger `member_profiles_column_rules` decides which columns a given caller may
change, so "a student may edit their phone number but not their CGPA" is a
write rule in the database rather than a disabled input in React.

### 3.2 Hierarchy — not a role enum

Authority is a **rank**, and a job is a **tag**:

- `priority_levels` — sparse integer ranks, lower is more senior. The captain
  holds a reserved rung nobody can be invited onto (`0013`).
- `tags` / `user_tags` — what someone *does*: `admin`, `hod`, `mentor`,
  `club:robotics`. Two people at the same rank can hold entirely different
  jobs, and a new job needs no schema change.
- `role_assignments` — the join that matters: a user holds a level, optionally
  scoped to an `org_unit_id`, optionally time-boxed (`valid_from`/`valid_until`,
  read through `assignment_is_current()`), with `is_primary` marking the main
  one. **A person may hold several at once.** This is the single biggest
  departure from v1, where a user had exactly one level.

The org itself is `org_units` (a self-referencing tree: faculty → programme),
then `batches`, then `sections`. `in_org_subtree(ancestor, descendant)`
answers containment, and it is the function every scoped check is built on.

### 3.3 Request taxonomy

`request_types` (with `decision_mode`: `approval` or `log_only`) →
`request_categories`, a self-referencing tree of unbounded depth — "OD → Tech →
Hackathon". A category carries its `classification` (`tech` / `non_tech`),
because a tech club running a non-tech event counts as non-tech.

Around a category hang the things that configure it:
`category_first_hop_options` (the picker's suggestions, resolved to real people
by tag at request time), `category_initiators` (who may raise it at all — no
rows means open to everyone), `category_level_roles`, `level_checks`,
`field_definitions`, and — the layer that actually drives movement —
`category_stages` and `stage_tasks` (§5).

> Two of those are **structurally present and not driven by anything**:
> `level_checks` has no write RPC and no UI, and
> `category_level_roles.participation = 'approves'` is read by no code. Only
> its `'notified'` rows do work, through `add_configured_watchers()`. They are
> named here so the next reader does not mistake them for mechanism.

### 3.4 Requests

`requests` holds `reference_number`, `status` (the `request_status` enum),
`current_holder`, `current_level_id`, `current_stage_id`, `org_unit_id`, and
`decision_mode` **copied from the type at creation** — a category's mode
changing later must not alter tickets already in flight.

Around it: `request_assignment_history` (every hop and decision, append-only in
practice), `request_watchers`, `request_participants` (group requests, each
with an `acceptance_status` the named person controls),
`request_check_results`, `request_field_values`, `request_comments`, and
`request_attachments`.

### 3.5 Signatures, documents, verification

A staff member registers **one** signature (`signature_assets`), drawn or
uploaded, and it is stamped onto every document from then on — matching how
physical signing actually worked.

`signatures` is the decision record: signer, level, decision, and
`state_hash`. `request_state_hash()` (`0017_document_templates.sql:32`) defines
"what was signed" — reference number, title, body, category, **and every custom
field value**, in explicit `order by field_key`, because a hash over an
unordered aggregate is not reproducible and reproducibility is the entire
point. Field *values* are hashed; field definition *ids* are not, so renaming a
label does not invalidate a signed document but changing a value does.

`document_templates` are authored by the captain in the dashboard, per
category. No fixture data: Annexure 4.4 and the NOC are not shipped as
hardcoded strings. `render_document()` (`0020:13`) populates a template and
stamps the signatures; `generated_documents` stores the reference code, the
hash, and which signatures were used. `verify_document()` (`0017:361`) looks up
a code and compares the hash — **it does not care whether any file exists**.
The PDF is disposable; the row is what is protected.

### 3.6 Attachments and their lifecycle

`request_attachments` carries a `purge_after` column and a partial index,
`attachments_pending_purge`, over the rows that have one.

**Nothing fills it in, and nothing acts on it.** The trigger
`schedule_attachment_purge()` (`0002_requests.sql:362`) stamps `purge_after`
when a request's status becomes `closed` and the category's
`retain_attachments_after_close` is false — but **no code path anywhere in
schema-v2 writes `status = 'closed'`**, so the trigger has never fired, and the
external job that would read the index and delete from Garage was never built
(`SECURITY.md` R-24). Attachment retention is therefore *configuration
describing an intention*, not behaviour. Material collected after an event
belongs to a follow-up stage (§5.4) instead.

### 3.7 Comments and visibility

`request_comments.visibility` is `public` or `internal`, and the trigger
`block_base_level_internal_comment()` makes it structurally impossible for a
base-level (student) user to author an `internal` one — a denied write, not a
hidden read.

`level_visibility_rules(viewer_level_id, target_level_id, scope, mode)`
configures peer visibility: `mode` is `none` / `search_only` / `list`, and
`scope` is `same_subtree` or `any`. RLS honours both modes identically; the
*list versus search* distinction is applied by the query layer, because RLS
cannot know whether it is answering a list or a lookup.

### 3.8 Signup and provisioning

`allowed_login_domains` is a flat allowlist — one org, several login domains,
not multi-tenancy. `pending_assignments` is the invite: an email, the level and
tags it will grant, and who issued it. `apply_pending_assignment()`
(`0004:123`) fires on `profiles` insert and grants the declared role
server-side, so no client ever holds an elevated key.

`check_allowed_domain()` (`0004:86`) is a trigger on `auth.users` insert —
before a profile exists, so someone hitting the GoTrue signup API directly is
still rejected. **It is not a domain check alone.** It demands an allowed
domain **and** an unconsumed `pending_assignments` row. Three ways past it, and
only three:

1. **Bootstrap** — `is_bootstrapping() and not exists (select 1 from profiles)`
   returns early with neither domain nor invite. Only the very first account,
   the captain; the `not exists` clause makes it one-shot even if setup was
   abandoned before an admin tag was granted.
2. **Invited staff** — a `pending_assignments` row written by `create_invite()`
   with `invited_by = auth.uid()`, gated by `can_invite()` and the `pa_insert`
   policy.
3. **Student self-registration** — `self_register()`
   (`0012_remaining_write_rpcs.sql:90`) writes the *same table* with
   `invited_by = null`, forced to the base level, `member_type = 'student'`, no
   tags, and `reg_no_matches_batch()`. The `pa_self_register` policy grants
   this to `anon`.

So the "two signup paths" are two ways a row reaches `pending_assignments`
before the gate runs, not two paths through the gate — it asks everyone the
same two questions.

`pa_self_register` is deliberately not identity-checked, because the caller has
no session yet. **The email confirmation step is therefore the entire
authentication of a student account**, which is the mechanical reason
`GOTRUE_MAILER_AUTOCONFIRM` must stay `"false"` on any instance real people can
reach (`NOTE.md` 2026-08-25, `DEPLOY.md` A.7).

---

## 4. Authorization

### 4.1 The rank rule

v1 had one `my_rank()` returning a scalar, because a user had exactly one
level. v2 splits it, and choosing wrong is an authorization hole that RLS will
enforce confidently and silently:

| Function | Answers | Use for |
|---|---|---|
| `my_best_rank()` (`0001:350`) | most senior rank held **anywhere** | coarse "may this person reach the admin area at all" |
| `my_rank_in(org_unit)` (`0001:374`) | rank **within that part of the org** | everything row-scoped |

An HOD of Cyber Security outranks a Cyber student and **not** an AIML one, and
only the second function can tell the difference. Every policy in `0003` states
which it uses and why; a row-scoped policy reaching for `my_best_rank()` is the
bug that comment exists to prevent.

### 4.2 Helper functions, written once

Any relationship check is a `security definer` SQL function, reused everywhere,
never inlined twice into policies — and every one pins `set search_path =
public`, because a trigger that resolves the wrong tables is silent.

```
my_best_rank()          my_rank_in(org_unit)     in_org_subtree(a, d)
has_tag(code)           has_tag_or_ancestor()    holds_kind(kind)
is_lowest_level()       assignment_is_current()  has_mfa()
is_bootstrapping()      can_bootstrap()          can_see_request(id)
can_invite(level, unit) can_read_signature(key)  can_print(id)
```

`can_see_request()` (`0003:37`) is the single definition of request visibility,
reused by every request-related table's policy: your own ticket, one sitting
with you, one you are a participant on, one you were notified about or have
held, one you outrank *within its own org scope*, one a
`level_visibility_rules` row exposes, or `has_tag('admin')`. It is a function
rather than a repeated subquery because referencing an RLS-protected table from
inside another table's policy is how recursive-policy surprises happen.

**`FORCE ROW LEVEL SECURITY` everywhere**, not merely `ENABLE`: plain `ENABLE`
does not apply to a table's owner, so if the connecting role ever turned out to
own these tables the whole model would be bypassed in silence.

> **Trap for new tables.** `0003_rls.sql` and `0009_editing_and_deletes.sql`
> build policies by iterating **literal arrays of table names**, so a table
> added later arrives with no policies at all. A new table needs hand-written
> RLS plus a repeat of `0003`'s "every table in public has RLS" assertion, and
> `admin_delete()`'s allowlist (`0026:217`) is a literal array too.

### 4.3 Two-layer MFA

Signing in with a password alone produced a persisted `aal1` session, and
nothing below the frontend cared. `0016_require_mfa.sql` fixed that in two
layers, deliberately:

1. **`require_mfa()` (`0016:84`) on `PGRST_DB_PRE_REQUEST`.** This is the only
   thing that covers RPCs — they are `security definer` and bypass RLS
   entirely. It runs before every request, so an RPC added later is covered
   without anyone remembering to guard it.
2. **`mfa_satisfied()` folded into every RLS policy.** Layer 1 lives in an
   environment variable, and a control that disappears when an env var is
   dropped is not the boundary `CLAUDE.md` says RLS is.

**Coupling warning:** `docker-compose.yml` sets `PGRST_DB_PRE_REQUEST` to
`public.require_mfa`. Dropping or renaming that function takes the entire REST
API down.

Two sharp edges worth knowing before trusting either layer:

- `mfa_satisfied()` (`0025_restore_mfa_definer.sql`) returns **true** for anon,
  for `service_role`, and for a signed-in user with **no verified factor** —
  MFA is opt-in-by-enrolment at the database level, not universal.
- GoTrue carries `aal2` across refresh-token rotation, so **`aal2` is sticky
  and is not a freshness signal.** The `amr` array's `totp` timestamp is, which
  is what `totp_freshness()` (`0014:9`) reads — its own default is five
  minutes, and `mfa_satisfied()` calls it with 3600.

`0024` replaced these two functions and omitted `security definer`, which
silently downgraded them to SECURITY INVOKER and took the site down for a day;
`0025` restored it. **`create or replace function` replaces the SECURITY
attribute along with the body** — every migration since repeats the word
explicitly.

### 4.4 Everything writes through an RPC

The browser never writes a table: no `insert`, `update`, `delete` or `upsert`
from `app/src/lib/`. Reads may be plain selects where RLS already says the
right thing. Writes go to `security definer` functions — `create_invite`,
`assign_role`, `update_member_profile`, `save_field_values`,
`save_category_stages`, `record_task_result`, and the rest — which is why RLS
policies can stay narrow: the RPC checks the intent, RLS backs it up.

`admin_delete(table, id)` is the one generic destructive path, and it refuses
anything not in its allowlist and anything with `blocking_references()`.

---

## 5. The request lifecycle

### 5.1 Raising one

`create_and_submit_request()` (`0028_stage_gates.sql:22`) checks
`may_file_category()` first — a category with no `category_initiators` rows
stays open to everyone, so this changes nothing until configured. It copies the
type's `decision_mode` onto the row, stamps a reference number, records the
submission in `request_assignment_history`, and then calls `advance_stage()`.

### 5.2 Stages

`category_stages` (`0026:42`) gives a category an ordered walk: each stage has a
`stage_no`, a name, the `level_id` that checks it, and a `stage_kind`
(`approval` or `post_approval`). A stage is its own row rather than a
(category, level) pair, so "mentor verifies, HOD reviews, mentor countersigns"
is representable.

`resolve_stage_holder()` (`0027:289`) turns a stage into a person: a current
role assignment at that level, never the requester, scoped by
`in_org_subtree()`, preferring a primary assignment and an org-scoped one over
an institute-wide one. `advance_stage()` (`0027:343`) walks to the next
**approval** stage that has a holder, logging `stage_skipped` for the ones
nobody currently fills.

### 5.3 Tasks

`stage_tasks` (`0026:67`) is what "the options are baked in" was about before
v3: a task has a `label` and an `answer_type` (`yes_no`, `choice`, `text`,
`number`, `date`, `file`, `acknowledge`), with `options` the captain types.

Three dimensions make it work:

- **`actor`** — `stage_role`, `requester`, or `any_participant`. One stage
  genuinely has two: the mentor ticks parent permission while the *student*
  uploads proof of selection. `request_check_results`' insert policy admits
  neither of the second case's people, which is why filling a task is
  `record_task_result()` (`0027:401`) rather than a widened policy.
- **`result` versus `answer`** — `result` is "did this clear", `answer` is what
  was chosen, and `passing_answers` maps between them. Answering *no* to
  "parent permission taken" records the answer and does not clear the stage.
- **`scope`** — `request` or `per_participant`. A per-participant requirement
  is floored at one in `stage_tasks_outstanding()` (`0027:317`), so a required
  task cannot pass vacuously on a ticket with nobody on it.

`forward_request()` and an *approving* `decide_request()` both refuse while a
required task is outstanding. A rejection is always possible — a mentor who
cannot approve must still be able to say no rather than strand the ticket.

### 5.4 Follow-up after approval

A `post_approval` stage never gates approval and never gates printing. On the
last approval, `decide_request()` (`0029:375`) parks the request on the first
follow-up stage with its status still `approved` and its holder still nobody;
`record_task_result()` hops to the next one when a stage's required tasks are
answered. A task only the stage's role could answer is refused on such a stage,
since an approved request is on nobody's desk.

`can_print()` (`0029:339`) asks the approval chain only: the request is
visible, its status is approved/reviewed/closed, every held approval stage
carries a signature at its level (for an `approval` type — a `log_only` type
writes none by design), and no required approval-stage task is outstanding.

---

## 6. Storage

### 6.1 Garage as primary, cloud as backup only

Files live in **Garage**, self-hosted, on a Docker volume that should sit on a
separately attached block volume rather than the boot disk.
`garage/garage.toml` configures single-node operation
(`replication_mode = "none"`), and `storage-api` points at it as its
S3-compatible backend. This reversed an earlier plan to use Cloudflare R2 as
primary; R2 or B2 is now an encrypted offsite backup target only. Self-hosting
the thing users touch constantly was judged more consistent with the goal, at
the cost of owning durability directly.

### 6.2 The durability tradeoff, explicitly

Single-node Garage has no replication. A disk failure loses everything on it,
which is why the offsite encrypted backup is not optional polish. **A backup
that has never been restored is a hypothesis, not a backup** — the restore
drill is a go-live gate (`SECURITY.md`, `TASK.md`).

### 6.3 What actually needs protecting

| | Needs real backup discipline | Why |
|---|---|---|
| Certificates and post-event evidence | **Yes** | Irreplaceable and permanent. Note that nothing purges anything today (§3.6), so *every* attachment is currently permanent by accident rather than by policy. |
| Generated PDFs (Annexure 4.4, NOC) | No | Regenerated identically from `generated_documents` + `signature_assets` + the request row |
| `signature_assets` | Mildly | Losing one means re-registering a stamp; small, so include it |

### 6.4 Who may read a signature

`can_read_signature()` (`0018:27`) is not "anyone signed in". A signature image
is the raw material for forging a document, so a stamp is fetchable only by
someone who can see a request that person actually signed — in practice the
student downloading their own approved OD and the staff in its chain. Forgery
is separately defeated by the reference code that a fabricated PDF cannot
carry, but "the ingredients were never handed out" is the stronger position.

---

## 7. Architecture Decision Record

| Decision | Rationale |
|---|---|
| Self-hosted Supabase over custom Keycloak+Node | Restores `auth.uid()`/RLS as a real boundary without building and proving correct a custom authorization engine. |
| Priority levels + tags over a fixed role enum | Two people at the same rank can hold entirely different jobs; tags carry that without a schema change per org. |
| Several scoped `role_assignments` per person, not one level | The real org has HODs who are also mentors, and authority that is scoped and time-boxed. |
| `my_rank_in()` for every row-scoped decision | A rank held in one programme must not confer authority in another. |
| `decision_mode` copied onto the request | A category's mode changing later must not silently alter requests in flight. |
| Every write through a `security definer` RPC | The frontend states intent; the database decides. RLS stays the boundary underneath. |
| MFA enforced in two layers | The pre-request hook is the only thing covering RPCs; the policy fold is what survives a misconfigured env var. |
| Stages as their own table, not (category, level) | A pair is primary-keyed on both columns and cannot represent the same role appearing twice in one walk. |
| Filling a task is an RPC, not a widened policy | One stage has two actors, and the existing insert policy admits neither the student nor a club coordinator. |
| Follow-up stages never gate printing | The OD letter is needed before the event; the certificate cannot exist until after it. |
| Generated documents are cache, not source of truth | `state_hash` + `reference_code` protect authenticity; the PDF is disposable. |
| One stored signature per person, reused | Matches how physical signing worked — sign once, stamp thereafter. |
| Garage self-hosted as primary, cloud as backup only | Consistent with self-hosting, at the cost of owning durability — mitigated by treating the offsite backup as load-bearing. |
| `FORCE ROW LEVEL SECURITY` everywhere | Plain `ENABLE` does not apply to the table owner. |
