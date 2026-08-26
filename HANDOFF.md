# HANDOFF — V3 in progress

**Written:** 2026-08-25, revised 2026-08-26. Replaces the 2026-08-19 version,
which described v2 as written-and-unapplied and the frontend as targeting v1.
Both were true then and neither is true now.
**For:** whoever picks this up next, including a fresh Claude Code session on
the VPS.

> This document is the state of the project. It is deliberately blunt about
> what is proven, what merely compiles, and what is a known gap wearing a
> finished-looking surface. When any document and the migration files
> disagree, the files are right.

From here on the project is versioned **`x.xx.xxx`** — major (a change in
structure) . minor . update. V2 closed with the workflow layer (`0001`–`0029`).
V3 is underway: `0030`–`0032` fixed three bugs (two the browser pass
surfaced, one the participants panel did), and the task-completion UI and
participants panel — real gaps this document originally failed to name as
starting points — are both built. Dark mode / a DESIGN.md rewrite is agreed
in scope but not started — see §11.

---

## 1. The one-paragraph version

Basecamp is a self-hosted request/ticketing platform, first configured for OD
approvals at SRM Trichy, live at `https://basecamp.hackerxploit.org`.
`supabase/schema-v2/0001`–`0032` are applied, the frontend targets them, and
the wizard, MFA, invites, invite email, org admin, people admin, documents,
signatures, the workflow editor and task completion have all been exercised
against the running stack — the editor and task RPCs live, with a real
category the captain built. What has **not** been browser-driven: the
mobile facet toggle and person card at phone width, and the task-completion
UI's own React component (its RPC contract is separately verified — see §4).
Bulk invite is deployed but has not been run against a real batch.

---

## 2. What is running right now

| Thing | State |
|---|---|
| VPS | netcup, Ubuntu, `152.53.18.209`, rebuilt from fresh ISO 2026-08-18 |
| Stack | `docker compose` — db, auth, rest, realtime, storage, garage, meta, studio, kong, frontend, mailer |
| Public entry | Cloudflare Tunnel → Kong on `127.0.0.1:8000`. No inbound ports for the app. |
| Mail | Mailcow **on the same host**, serving `hackerxploit.org` |
| Schema applied | `supabase/schema-v2/0001`–`0032`, all rows in `basecamp_meta.schema_migrations` |
| Accounts | one captain, plus the handful of people invited by hand since |
| Frontend | The Countersigned Slip rebrand, SRM palette, live |

`supabase/migrations/` (v1) is **retired**. It does not describe this database
and cannot be applied over it. `scripts/apply-migrations.sh` defaults
`MIGRATION_DIR` to `supabase/schema-v2`, keys the ledger on filename, wraps
each file in `psql -1`, and is safe to re-run — it only ever applies what is
missing. Its header still tells the pre-reset story and should be read as
history.

**Deploys happen on build.** `docker-compose.yml` bind-mounts
`./app/dist:/usr/share/nginx/html:ro`, so `npm run build` publishes straight
to production. There is no separate deploy step and no staging.

---

## 3. What V2 ends with: the workflow layer

`0026`–`0029` are the last thing V2 built, and they exist because the
configuration that looked configurable was not:

- `level_checks` had been in the schema since `0002` with **no write RPC and
  no UI**, and its `check_type` was one of three fixed strings — so even with
  a screen, nobody could have written "parent permission taken [yes/no]".
- `category_level_roles.participation = 'approves'` was **read by nothing**.
  There was no stage sequence in the runtime at all; a request moved because
  somebody forwarded it and named a person.

So stages are a new mechanism rather than a config table over an old one:

| Piece | Where |
|---|---|
| `category_stages`, `stage_tasks`, `category_initiators`, participants phase/window | `0026` |
| authoring RPCs (`save_category_stages`, `save_stage_tasks`, `save_category_initiators`, `category_workflow`), `advance_stage`, `record_task_result`, `stage_tasks_outstanding`, `add_participant_by_reg_no`, `can_print` | `0027` |
| the three lifecycle RPCs re-issued with stage gates | `0028` |
| `stage_kind`, follow-up after approval | `0029` |
| the editor | `app/src/components/workflow/StagesEditor.tsx`, `app/src/lib/workflow.ts` |

Three rules hold across all of it. **Tasks carry an actor** (`stage_role`,
`requester`, `any_participant`) because a single stage genuinely has two —
the mentor ticks parent permission, the student uploads proof of selection —
and `request_check_results`' insert policy admits neither of the second case's
people; that is why filling a task is an RPC and not a widened policy.
**`result` and `answer` are different questions**: `result` is "did this
clear", `answer` is what was chosen, and `passing_answers` maps between them,
so answering *no* to "parent permission taken" records the answer and does not
clear the stage. **A follow-up stage never gates approval or printing** — it
opens once the chain finishes, sits on nobody's desk, and its tasks are
answered by the requester.

The reasoning, the rejected alternatives, and every verification run are in
`V3-WORKFLOW.md`. It is the design document for this layer and is current.

---

## 4. What V3 has done so far (`0030`–`0032`)

The browser pass this document called for happened, with the captain,
against the live stack and a real category the captain built live
("Internal OD", two stages). It found two real bugs; building the
participants panel afterward found a third, a security gap rather than a
broken feature. All three fixed and applied:

- **`0030`** — `create_first_hop_option()` inserted into
  `category_first_hop_options.resolve_tag`, a column that has never existed
  on that table (it has been `tag_id` since `0002`). First-hop routing
  configuration was broken from the moment it was written; nobody had tried
  to configure it on a real category until the captain did. Fixed to resolve
  the tag code to an id. The frontend read side (`org.ts`) had the matching
  bug — reading the same nonexistent column, plus a `is_default` field the
  schema never had at all.
- **`0031`** — `save_stage_tasks()` wrote `passing_answers` and `options`
  with `t -> 'key'`, which turns a JSON `null` in the payload into the jsonb
  scalar `null`, not SQL `NULL`. `record_task_result()`'s `passing_answers is
  null` check — meant to mean "any answer clears this task" — never fired, so
  every task saved with no `passing_answers` configured was marked `failed`
  regardless of the answer given. Fixed, and the three tasks already written
  wrong were backfilled in the same migration.

Also fixed, frontend-only, no migration: the routing-option delete button and
the invite-revoke button both swallowed `admin_delete()`/`revoke_invite()`'s
TOTP re-verification failure instead of showing the confirm dialog every
other delete in the app uses — clicking delete just silently did nothing.
Both now go through `ConfirmDestructive`.

**Two things learned about the live data, not bugs:** nobody currently holds
the `mentor` tag, so `advance_stage`'s no-holder skip is doing real work on
the one live request (`REQ-2026-E25A93` landed on `HOD Approval` without ever
sitting on stage 1) — worth knowing before assuming a stage 1 gate is being
enforced. And `category_initiators` restricted to the `student` tag will
block any account that hasn't been granted it explicitly — `student` is not
auto-granted at registration the way `hod`/`mentor` are. The captain's call:
leave it manual, granted deliberately (through invite, including the new bulk
invite below) rather than automatic.

**Built, not yet browser-verified:** the task-completion UI
(`app/src/components/workflow/StageTasks.tsx`) — renders the current stage's
tasks on request detail, gated by the same actor rules the RPC enforces,
disables Approve while required tasks are outstanding. The RPC contract
(`record_task_result`, `stage_tasks_outstanding`) is verified correct via a
rolled-back transaction against the live "HOD Approval" task, both before
`0031` (wrong) and after (right). The component itself has not been driven in
a real browser session — that needs the HOD's own login, which wasn't
available this session.

Also built, same caveat: bulk invite (`InvitePanel.tsx`) — a paste-list UI
over the existing `create_invite()` RPC, looped client-side, no migration.
Deployed and typechecks. **Not run against a real batch yet** — the captain
deferred testing it. Don't move this into "proven" until that happens.

And the request-detail participants panel
(`app/src/components/workflow/ParticipantsPanel.tsx`) — lists
`request_participants`, adds by register number, accept/decline. Building
it surfaced a third bug, this one a security gap rather than a broken
feature: 0003's `participants_update` RLS policy has no `WITH CHECK`, so
it constrains which *row* a participant may update but not which
*columns* — `parent_consent_verified` and the `snapshot_*` fields sit on
the same row as `acceptance_status`, and 0002's own comment says parent
consent is the mentor's to fill in by phone, never the student's to
self-certify. A frontend that scopes its own update to two columns doesn't
close that; a raw PATCH to the same row could touch any of them. `0032`
adds `respond_to_participation()`, writing exactly `acceptance_status` and
a server-stamped `accepted_at`, and narrows the policy to the holder/admin
arms only. Verified live: the RPC works for the participant, and the
direct-update tamper path now affects 0 rows.

---

## 5. Proven, and not proven

**Exercised against the running stack, this session, live with the
captain:** the rail dropdown opening upward, dashboard tile counts, org
units & batches, the stages editor's three RPCs (round-tripped a real
category's real config), first-hop routing insert/delete after `0030`,
invite revoke after its fix.

**Exercised against the running stack, earlier sessions:** setup wizard,
TOTP enrolment, login, invite creation, invite email to Zoho and Gmail,
`/invite/<token>` accept, org-unit and batch admin, people admin, document
templates, signature capture and public verification.

**Exercised against the live database inside rolled-back transactions**
(`begin; … rollback;`, which is how every stage change was tested, including
`0031`'s fix): stage authoring round-trips through `category_workflow`; a
stage with recorded answers refuses removal; a submitted request lands on the
first stage somebody holds and skips one nobody holds; all three actor rules;
a required per-participant task blocking an empty ticket; approval advancing
rather than closing; the last approval closing with signatures and
`can_print` true; the participant window opening; scanning being idempotent;
both follow-up refusals; two chained follow-up stages; `record_task_result`
clearing a task with no `passing_answers` (post-`0031`); `add_participant_by_
reg_no` and `respond_to_participation` against a real request and real
accounts (post-`0032`), including confirming `0032` actually closed the
column-tamper hole it was written for — a direct `update ... set is_leader`
as the participant now affects 0 rows.

**Not proven:** the mobile facet toggle at 390px and the person card at
phone width — window resize didn't take effect in this session's browser
automation, and both are student-only UI the captain role can't reach
directly. The task-completion UI, the participants panel, and bulk invite —
all built and RPC-verified per §4, none driven in a real browser session
yet. The error-detail and signature-size changes from earlier commits.

---

## 6. Conventions that are not negotiable

**Commit as the git default author.** No `Co-Authored-By` trailers, no other
attribution. Stated directly, 2026-08-18.

**No fixture data, ever.** A real deployment gets exactly one account from the
wizard — the captain. Every level, tag, org unit and account after that is
created by hand by a human at the right level. `supabase/seed.sql` is
demo-only and must never run on a real instance.

**Frontend → RPC → database.** The browser never writes a table directly: no
`insert`, `update`, `delete` or `upsert` from `app/src/lib/`. Reads may be
plain selects where RLS already says the right thing.

**RLS is the authorization boundary**, never a frontend check. Relationship
checks are `security definer` functions, written once, reused, always pinning
`set search_path = public`.

**`GOTRUE_MAILER_AUTOCONFIRM` stays `"false"`.** Do not flip it, not even to
get past a signup problem while testing.

**Verify against a running stack**, and say plainly what was and was not
verified.

---

## 7. Traps that have already cost time

- **`create or replace function` replaces the SECURITY attribute along with
  the body.** Omit `security definer` on a replacement and the function
  silently becomes SECURITY INVOKER. `0024` did this to two MFA helpers and
  took the site down for a day — every login looped back to the sign-in
  screen. `0025` restored it. Every migration since repeats the word
  explicitly, including on replacements.
- **A SQL (non-plpgsql) function is inlined by the planner**, so a `case`
  branch that "can never be reached" still has its sublink evaluated. `case`
  is not a guard against a privileged table read.
- **`set_config(..., true)` is transaction-local**, and psql autocommits — so
  simulated JWT claims vanish between statements. Test inside an explicit
  `begin; … rollback;`.
- **`0003_rls.sql` and `0009_editing_and_deletes.sql` build policies by
  iterating literal arrays of table names**, so a new table arrives with no
  policies at all. New tables need hand-written RLS plus a repeat of `0003`'s
  "every table in public has RLS" assertion. `admin_delete()`'s allowlist is a
  literal array too.
- **Migrations before `auth` is up** → `relation "auth.mfa_factors" does not
  exist`. GoTrue creates that table on first connect.
- **`bootstrap-db-roles.sh` runs twice**, and the two runs do different
  things: Supabase role passwords first, the mailer password later, for a role
  that does not exist until the invite migration.
- **`docker compose up -d` before the first frontend build** → Docker creates
  `app/dist` as root and the next `npm run build` dies with `EACCES` wearing a
  Vite stack trace. Build first.
- **Missing `app/.env.local`** → blank white page, no error. Vite inlines
  `VITE_*` at build time; only a rebuild fixes it.
- **Kong routes `/` to the frontend as a catch-all**, and
  `nginx/frontend.conf` supplies the SPA fallback so `/invite/<token>`
  resolves on a cold load.
- **GoTrue carries `aal2` across refresh-token rotation**, so `aal2` is
  sticky and is not a freshness signal. The `amr` array's `totp` timestamp is.
- **`mfa_satisfied()` returns TRUE for anon and for a user with no verified
  factor** — MFA is opt-in-by-enrolment at the database level.
- **A rolled-back-transaction test of a table read needs a full simulated
  JWT, not just `sub`.** `set_config('request.jwt.claims', ...)` with only
  `sub`/`role` passes every `SECURITY DEFINER` function called directly (they
  don't check `mfa_satisfied()`'s AAL clause the same way), but every
  `requests`/`request_*` RLS policy also requires `mfa_satisfied()`, which for
  `aal2` needs `totp_freshness(3600) = 'fresh'` — a fresh `amr` entry
  (`{"method":"totp","timestamp":<now>}`) in the same claims. Without it, a
  plain `select * from requests` under `set local role authenticated` returns
  zero rows for every request, with no error, which looks exactly like an RLS
  bug and isn't one.
- **`jsonb`'s `->` operator turns a JSON `null` in an RPC payload into the
  jsonb scalar `null`, not SQL `NULL`.** `t -> 'passing_answers'` on
  `{"passing_answers": null}` is `'null'::jsonb`, and `x is null` is false for
  it. `0031` hit this in `save_stage_tasks()` — wrap any such extraction in
  `nullif(t -> 'key', 'null'::jsonb)` when a JSON key is expected to mean "no
  value", not "the JSON null value".

---

## 8. Known gaps — surfaces that look finished and are not

- **Nothing ever writes `status = 'closed'`.** The only reader is
  `schedule_attachment_purge`, so `retain_attachments_after_close` has never
  fired once, and the job that would act on `purge_after` is unbuilt
  (`SECURITY.md` R-24). Introducing a close state would fire that trigger for
  the first time with nothing behind it — a decision to take deliberately.
- **`category_stages.is_optional`** is written by the save RPC and read by
  nothing. No control was built for it. `advance_stage` skips a stage with no
  holder, which is not the same thing.
- **Re-answering a task overwrites the previous answer.** There is no
  per-task audit trail; the "no" before the "yes" leaves no trace.
- **Flipping a category's `participant_phase` after per-participant tasks are
  authored is unguarded**, because category edits do not go through an RPC.
- **`hasCompletedMfa()` in `app/src/lib/auth.ts` is dead code.**
- **28 CSS findings** from the `impeccable` pass remain unresolved in
  `components.css` — mostly print/document sanctioned exceptions, plus genuine
  fallback drift (`var(--ink-soft, #6b7280)`, `var(--accent, #2563eb)`). None
  came from recent changes.

---

## 9. Open questions

Carried from `PRD-V2.md`, still gating real work:

- **§8.3** — is the register-number serial always 3 digits, and does it
  restart per batch? Do lateral-entry students follow the same format?
- **§11.1** — is the FET ID format fixed and validatable, or free-form?
- **§9.3** — do CGPA collection windows apply per programme, per batch, or
  institute-wide?

From the workflow layer (`V3-WORKFLOW.md` §5):

- Should `can_print` be one question per request, as built, or one per
  document type? One was chosen because "is this finished" is the same
  question for the NOC and the OD.
- Should `can_read_signature()` narrow from "a request they signed" to "this
  request"?
- Should the MFA re-prompt clock be per level — the `3600` literal in
  `mfa_satisfied()` becoming a column on `priority_levels`?

Deferred by the captain, on the record: rank-gating for tech/non-tech
activity counts on the person card, and session/token handling — "sb access
token, remember in the next version we have to change it."

---

## 10. Where V3 goes next

1. **Bulk invite against a real batch** — deployed, untested. Do this before
   closing public registration, a decision the captain has asked for but not
   yet acted on: `self_register()` is still granted to `anon`, and the
   `pa_self_register` RLS policy still allows a direct anon insert into
   `pending_assignments` — closing registration means revoking both, not
   just removing the `/register` route, per §6's RLS rule.
2. **The task-completion UI and the participants panel in a real browser** —
   both built (§4), both RPC-verified via rolled-back transactions, neither
   driven as an actual React component yet. Needs a login as someone other
   than the captain — the captain role doesn't route to `/requests` at all.
   Test as the HOD or the requester on `REQ-2026-E25A93`, or any account
   holding a stage role or a participant place.
3. **Attachments** — `request_attachments` and its RLS policy exist since
   `0002`/`0003`. A storage upload path already exists for signatures
   (`app/src/lib/documents.ts` — `supabase.storage.from('signatures').upload()`
   paired with an RPC to record the object key), which is the template to
   follow; no bucket, upload UI, or wiring for attachments exists yet. Also
   the actual dependency `StageTasks.tsx` is waiting on — `answer_type ===
   'file'` tasks are stubbed with "coming with attachments."
4. **pdfme** (`github.com/pdfme/pdfme`) — generated client-side, signatures
   supplied by the server, never stored, gated on `can_print`.
5. Then the questions in §9, and the gaps in §8 that turn out to matter.

---

## 11. Dark mode and the DESIGN.md rewrite — agreed, not started

The captain asked for `sd.srmist.edu.in` (SRM's generic ManageEngine
ServiceDesk instance) as design inspiration, filtered through `/impeccable`,
plus full light/dark theming. Two things to hold onto before starting:

- `sd.srmist.edu.in`'s dark chrome is stock vendor default, not a designed
  system — useful for layout/interaction ideas (category tree, field
  density, attachment placement), not as a palette to copy.
- DESIGN.md currently forbids this outright: "the topbar is the letterhead:
  white paper... never dark console chrome." The captain chose **full
  dual-theme, DESIGN.md gets rewritten** (not console-only-dark,
  not dropped) when asked directly. That is a reversal of the documented
  visual identity, and it also has to answer for print/document surfaces —
  a printed OD letter is white paper regardless of which theme the browser
  is in, so the rewrite needs to say explicitly which surfaces stay
  light-only and why.
- Do this with the captain looking at real screens, not by inferring taste
  from a stock ITSM palette. Concrete first step: define the token pairs in
  `components.css`, get one screen approved, then propagate. This also
  finally settles §8's 28 unresolved CSS findings and the type-ramp
  question — `0.9rem` literals appear unflagged in several places
  (`RequestsPage.tsx`) and should become a real step on the ramp or get
  replaced, not silently ignored.

---

## 12. Where to read what

| Document | What it is | Trust |
|---|---|---|
| `HANDOFF.md` | this file — state of the project, V3 in progress | Current |
| `V3-WORKFLOW.md` | the stages/tasks layer: design, decisions, every verification | Current, authoritative on the workflow |
| `PRD.md` | v1 product definition | Current |
| `PRD-V2.md` | v2 design, decisions D-1..D-6, open questions | Current |
| `ARCH.md` | the live v2 schema and why it is shaped that way, `0001`–`0029` | Current on structure; doesn't yet mention `0030`–`0032` (bug fixes and one RLS narrowing, not schema changes) |
| `NOTE.md` | dated decision and incident log, with reasoning | Current, authoritative on "why" |
| `TASK.md` | build tracker, known gaps | **Stale** — dated 2026-08-11, "v1.0.0", predates V2's close. Several items it flags as open (custom fields) are done; some it doesn't mention (attachments UI) are still gaps. Read `HANDOFF.md` §8 instead. |
| `SECURITY.md` | threat model, risk register R-01..R-32 | Current |
| `DEPLOY.md` | deployment runbook, Part C covers host rebuild | Current, battle-tested |
| `DESIGN.md` | the frontend's visual system | Current, but §11 commits to rewriting it for dual-theme — not started |
