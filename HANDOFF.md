# HANDOFF — V2, closed

**Written:** 2026-08-25. Replaces the 2026-08-19 version, which described v2
as written-and-unapplied and the frontend as targeting v1. Both were true
then and neither is true now.
**For:** whoever picks this up next, including a fresh Claude Code session on
the VPS.

> This document is the state of the project. It is deliberately blunt about
> what is proven, what merely compiles, and what is a known gap wearing a
> finished-looking surface. When any document and the migration files
> disagree, the files are right.

From here on the project is versioned **`x.xx.xxx`** — major (a change in
structure) . minor . update. What follows closes V2. V3 begins with the
participants panel and pdfme.

---

## 1. The one-paragraph version

Basecamp is a self-hosted request/ticketing platform, first configured for OD
approvals at SRM Trichy, live at `https://basecamp.hackerxploit.org`. **V2 is
deployed**: `supabase/schema-v2/0001`–`0029` are applied, the frontend targets
them, and the wizard, MFA, invites, invite email, org admin, people admin,
documents and signatures have all been exercised against the running stack.
V2 ends with the workflow layer — a captain can now write the stages a request
walks, the tasks that have to be filled in at each, who may file it, and what
is collected after the event — and with the screen that authors it. What V2
does **not** have is a browser pass over the last seven commits of UI.

---

## 2. What is running right now

| Thing | State |
|---|---|
| VPS | netcup, Ubuntu, `152.53.18.209`, rebuilt from fresh ISO 2026-08-18 |
| Stack | `docker compose` — db, auth, rest, realtime, storage, garage, meta, studio, kong, frontend, mailer |
| Public entry | Cloudflare Tunnel → Kong on `127.0.0.1:8000`. No inbound ports for the app. |
| Mail | Mailcow **on the same host**, serving `hackerxploit.org` |
| Schema applied | `supabase/schema-v2/0001`–`0029`, all 29 rows in `basecamp_meta.schema_migrations` |
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

## 4. Proven, and not proven

**Exercised against the running stack:** setup wizard, TOTP enrolment, login,
invite creation, invite email to Zoho and Gmail, `/invite/<token>` accept,
org-unit and batch admin, people admin, document templates, signature capture
and public verification.

**Exercised against the live database inside rolled-back transactions**
(`begin; … rollback;`, which is how every stage change was tested): stage
authoring round-trips through `category_workflow`; a stage with recorded
answers refuses removal; a submitted request lands on the first stage somebody
holds and skips one nobody holds; all three actor rules; a required
per-participant task blocking an empty ticket; approval advancing rather than
closing; the last approval closing with signatures and `can_print` true; the
participant window opening; scanning being idempotent; both follow-up
refusals; two chained follow-up stages.

**Not proven, and this is the real debt:** *seven commits of UI have never
been opened in a browser.* The rail dropdown opening upward, the dashboard
tile counts, the mobile facet toggle at 390px, the person card at phone width,
the error-detail and signature-size changes, and now every path through the
stages editor — its three RPCs, two re-reads, dirty diff and kind-flip. They
typecheck and build. "It typechecks" is not "it works", and this project has
repeatedly found bugs that only appear when run. A browser pass needs a fresh
session token from the captain and should be the first thing V3 does.

---

## 5. Conventions that are not negotiable

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

## 6. Traps that have already cost time

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

---

## 7. Known gaps — surfaces that look finished and are not

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

## 8. Open questions

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

## 9. Where V3 starts

1. **A browser pass over §4's unproven UI**, with a fresh session token.
2. **The request-detail participants panel** — accept/decline, and the scan
   window that `add_participant_by_reg_no` and `participants_open_until`
   already back.
3. **pdfme** (`github.com/pdfme/pdfme`) — generated client-side, signatures
   supplied by the server, never stored, gated on `can_print`.
4. Then the questions in §8, and the gaps in §7 that turn out to matter.

---

## 10. Where to read what

| Document | What it is | Trust |
|---|---|---|
| `HANDOFF.md` | this file — state of the project at the close of V2 | Current |
| `V3-WORKFLOW.md` | the stages/tasks layer: design, decisions, every verification | Current, authoritative on the workflow |
| `PRD.md` | v1 product definition | Current |
| `PRD-V2.md` | v2 design, decisions D-1..D-6, open questions | Current |
| `ARCH.md` | the live v2 schema and why it is shaped that way, `0001`–`0029` | Current |
| `NOTE.md` | dated decision and incident log, with reasoning | Current, authoritative on "why" |
| `TASK.md` | build tracker, known gaps | Current |
| `SECURITY.md` | threat model, risk register R-01..R-32 | Current |
| `DEPLOY.md` | deployment runbook, Part C covers host rebuild | Current, battle-tested |
| `DESIGN.md` | the frontend's visual system | Current |
