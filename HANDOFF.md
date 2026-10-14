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
V3 is underway: `0030`–`0035` fixed four bugs and two hardening/narrowing
passes (two the browser pass surfaced, one the participants panel did, one
self-review of the print path), and the task-completion UI, participants
panel, attachments, and a two-tier QR-verify flow are all built. `pdfme` was
considered and decided against — see §10. Dark mode / a DESIGN.md rewrite is
agreed in scope but not started — see §11.

---

## 1. The one-paragraph version

Basecamp is a self-hosted request/ticketing platform, first configured for OD
approvals at SRM Trichy, live at `https://basecamp.hackerxploit.org`.
`supabase/schema-v2/0001`–`0035` are applied, the frontend targets them, and
the wizard, MFA, invites, invite email, org admin, people admin, documents,
signatures, and the workflow editor have all been exercised against the
running stack, the editor live with a real category the captain built.
Four newer pieces — task completion, the participants panel, attachments,
and bulk invite — are built, deployed, and RPC-verified via rolled-back
transactions against real accounts and a real request, but **none has been
driven as an actual React component in a browser session**. What also
hasn't: the mobile facet toggle and person card at phone width, and bulk
invite against a real batch specifically (the captain deferred it).

---

## 2. What is running right now

| Thing | State |
|---|---|
| VPS | netcup, Ubuntu, `152.53.18.209`, rebuilt from fresh ISO 2026-08-18 |
| Stack | `docker compose` — db, auth, rest, realtime, storage, garage, meta, studio, kong, frontend, mailer |
| Public entry | Cloudflare Tunnel → Kong on `127.0.0.1:8000`. No inbound ports for the app. |
| Mail | Mailcow **on the same host**, serving `hackerxploit.org` |
| Schema applied | `supabase/schema-v2/0001`–`0035`, all rows in `basecamp_meta.schema_migrations` |
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

## 4. What V3 has done so far (`0030`–`0035`)

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

And attachments (`app/src/lib/attachments.ts`,
`app/src/components/documents/Attachments.tsx`) — `request_attachments`
(`0002`) and its table RLS (`0003`) had no bucket, storage policy, or
upload path until `0033`, which follows `0018`'s signature-storage pattern:
a private Garage bucket, `storage.objects` policies keyed on
`can_see_request()` against the object path's request-id segment (anyone
who can see the request can see its attachments, not just the uploader —
unlike a signature), and `record_attachment()` to write the row. `0034`
followed immediately: a defensive regex guard on the storage-policy cast
(tested safe without it, but see §7), and — the real fix —
`record_attachment()` now reads the actual `mime_type`/`size_bytes` off
`storage.objects.metadata` after upload instead of trusting the caller's
claim, and refuses if the object never finished uploading. Verified live in
both directions: refuses on a phantom object, and overrides a
client-claimed `mime_type`/`size_bytes` with the real ones once the object
exists. The upload UI itself, and the actual multipart HTTP path through
storage-api, haven't been driven by a real browser session.

`StageTasks.tsx`'s `answer_type === 'file'` stub is wired up. Decided against
a `task_id` column on `request_attachments`: `record_task_result()`'s answer
is already an unscoped `jsonb`, same as every other answer type, so a file
task answers with `{"attachment_id": ..., "file_name": ...}` pointing at a
row in the existing general-purpose `request_attachments` table —
`uploadAttachment()` (now returning the new row's id instead of discarding
it) followed by `recordTaskResult()`, no migration. The file still shows up
in the request's general attachments list too; that's one upload, not two
concepts.

**`0035`** — two follow-ups the captain raised together, both touching the
document-view code path:

- `can_read_signature()` (`0017`) checked "does this key's owner have a
  signature on *any* request the caller can see" — flagged loose in
  `V3-WORKFLOW.md` §5, not fixed because `storage.objects` RLS only ever
  sees the object key, never a request id, so there was no request to narrow
  *to* at that layer. Fixed properly this time: `render_document()` already
  knows exactly which signature keys it is about to hand a specific caller
  for a specific request, so it now stamps a 15-minute
  `signature_access_grants` row for each one, and the storage policy checks
  that grant instead of "any request they can see." New table, RLS-forced,
  no policies — only the two security-definer functions touch it. Verified
  live: the person who rendered the document can read the signature key
  afterward; an uninvolved account, signed in, cannot.
- `verify_document()` (`0017`) returned signer name/role/date to anyone with
  the reference code, which was the deliberate original design ("who signed
  it" was part of "public by design"). The captain wants two tiers instead:
  scanning the QR code with no account confirms the document is genuine and
  nothing more; signed in, any role, shows who signed it and when. Fixed by
  gating the `signatures` key on `auth.uid()` — `null` when the caller has
  no session, a (possibly empty) array otherwise. `VerifyPage.tsx` renders a
  "sign in to see who signed this" line when it gets `null`; no other
  client-side gating, the RPC already decided. Verified live: same reference
  code, `anon` role gets `signatures: null`, `authenticated` gets an array.
- Also added: every printed document now carries a QR code
  (`documents.ts`'s `verifyQrDataUrl()`, the `qrcode` package) encoding
  `/verify/<reference_code>`, next to the existing printed reference-code
  text. Adds ~26KB raw / ~10KB gzipped to the bundle — small next to the
  pdfme number in §10 because this is one focused, justified feature, not a
  competing renderer for something that already works.

**File uploads — signatures and attachments — have been silently broken
since first boot (2026-08-19).** Found this session, the first time anything
was actually uploaded through a real browser instead of verified via RPC:
every multipart upload to `storage-api`, to either bucket, failed with
`Limit fileSize is not a valid number`, a 400 from the storage container
itself, never reaching the database. Root cause: `storage-api`'s
`uploadFileSizeLimit` config is `Number(env var)` with no fallback — neither
`FILE_SIZE_LIMIT` nor `UPLOAD_FILE_SIZE_LIMIT` was ever set in
`docker-compose.yml`'s `storage` service, so that's `Number(undefined)` =
`NaN`, which `fastify-multipart` rejects outright before the request body is
even read. No RLS policy, no RPC, no rolled-back transaction could have
caught this — it only exists on the real multipart HTTP path, which this
project's whole testing convention (§6) deliberately never exercises.
Fixed: `FILE_SIZE_LIMIT: "20971520"` (20MB, plain bytes — this config path
uses `Number()`, not the `"50MB"`-string parser `storage-api` uses
elsewhere) added to the `storage` service, container recreated. Verified
live end to end as the HOD on `REQ-2026-E25A93`: uploaded a real file
through the actual UI, it listed with the right size, the signed-URL
download opened the real content, deleted it back out (both the storage
object and the `request_attachments` row) since it was test data, not
something to leave on a live request. **Signature capture was hit by the
exact same bug** — `storage-1`'s own logs show failed signature uploads
going back to 2026-08-19, which is why `signature_assets` was empty and
`REQ-2026-E25A93`'s HOD signature has never had an image, something earlier
sessions read as "nobody's gotten around to capturing a signature yet"
rather than "signature capture has never once worked." Not re-tested live
this session — doing so would mean capturing a real signature image for the
HOD's actual account, not a disposable test artefact, so that's left for
the captain to exercise deliberately rather than something to trigger
unprompted.

**The QR code's target URL had a trailing-slash hole that defeated the
entire point of `/verify` being public.** Found by the captain scanning a
printed document's real QR code and landing on the TOTP re-entry screen
instead of the verify page. `App.tsx`'s `verifyCodeFrom()` matched
`/verify/<code>` exactly — a trailing slash (several phone QR
scanners/share sheets add one) failed the regex, so the app fell through to
the normal `bootstrap()`/session flow instead of short-circuiting to the
public `VerifyPage`. With no session in the browser that lands on login; with
a signed-in-but-MFA-stale session — exactly what a captain's own phone would
have sitting around — it lands on `VerifyMfa`, demanding a TOTP code to see
whether someone else's document is genuine. Reproduced live (navigated to
`/verify/<code>/` with a stale session present, landed on the dashboard
instead of the verify page), fixed by trimming trailing slashes before the
match, rebuilt, and reconfirmed live: the same URL with the same stale
session now correctly shows "Genuine" with no auth prompt.

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
templates, public verification. **Signature capture was believed exercised
but was not** — it has failed with the `storage-api` file-size bug (§4)
since first boot; nobody had actually clicked the real upload button to
notice.

**Exercised against the running stack, this session, live as the HOD on
`REQ-2026-E25A93` (real session JWT, not the captain):** the request-detail
view end to end, including the attachments list, `can_print`-gated
Print/Save-as-PDF button (correctly disabled earlier, correctly enabled now
the request is fully approved), and the printed QR code. A real attachment
upload through the actual UI — which surfaced the `storage-api` bug above —
then, after the fix, a second upload that worked: listed with the right
size, the signed-URL download served the real content, both the storage
object and the `request_attachments` row removed afterward since it was
test data, not something to leave on a live request. `/verify`'s two-tier
signer disclosure confirmed over real HTTP (not a DB transaction) straight
through Kong and PostgREST: the same reference code returns
`signatures: []` with a valid bearer token and `signatures: null` with
none.

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
as the participant now affects 0 rows; `record_attachment` refusing a
phantom object and overriding a client-claimed `mime_type`/`size_bytes`
with the real ones read off `storage.objects.metadata` (post-`0034`).

**Not proven:** the mobile facet toggle at 390px and the person card at
phone width — window resize didn't take effect in this session's browser
automation, and both are student-only UI the captain role can't reach
directly. The task-completion UI and the participants panel are still
untested in a browser — `REQ-2026-E25A93`, the only real request in the
system, is fully `approved` with no active stage, so there was nothing for
either component to render against; both still need a request mid-workflow
and a login other than the HOD's. Bulk invite against a real batch (still
the captain's call to defer, per §10). Signature capture itself, now that
the upload bug is fixed — deliberately not exercised this session, see §4.
The error-detail and signature-size changes from earlier commits.

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
- **`npx tsc --noEmit` is not the authoritative typecheck in this repo —
  `npm run build` (`tsc -b`) is.** They disagree: `Attachments.tsx`'s
  `useEffect(() => promise, [...])` passed `--noEmit` clean and failed the
  real build (`tsc -b`'s project-reference mode catches an `EffectCallback`
  returning `Promise<void>` that plain `--noEmit` didn't). Trust the build.
- **RLS policy quals combine with `AND`/`OR`, which do short-circuit at
  execution time in Postgres** — unlike the SQL-function-inlining trap above,
  which is about the *planner* substituting a function body and evaluating a
  `case` branch's sublink regardless of reachability. A guard like
  `bucket_id = 'attachments' and (...)::uuid` is safe in practice (verified:
  inserting a non-uuid-named object into another bucket and querying it under
  RLS raised no cast error), but the two mechanisms look similar enough to
  worry about, so `0034` added a regex guard anyway — cheap, and it removes
  the question rather than resting on observed-not-guaranteed behaviour.

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
2. **Task completion (including the file-answer path) and the participants
   panel, in a real browser.** Both built (§4), both RPC-verified, neither
   driven as an actual React component yet — `REQ-2026-E25A93` is now fully
   `approved` with no active stage, so there is currently no live request
   either one has anything to render against. Needs a new request still
   mid-workflow, and a login other than the HOD's (which this session used
   to clear item 2's other half, below). Attachments, the printed QR code,
   `can_print` gating, and the two-tier `/verify` page are now proven live
   in a real browser, over real HTTP, as the HOD on `REQ-2026-E25A93` — see
   §4 and §5. That pass also found and fixed a real bug: file uploads (both
   buckets) had been silently failing since first boot over a `storage-api`
   config gap, never caught by any RPC-level test. Signature capture hits
   the same storage path and should now work, but has not been re-tried
   live — left for the captain, since testing it means capturing a real
   signature image on a real account, not disposable test data.
3. **pdfme — decided against, not deferred.** `V3-WORKFLOW.md` §2.5 (the
   design section that recommended it) is stale: it predates
   `DocumentView.tsx`, which already ships a working PDF path —
   `window.print()` on sanitised HTML, no server renderer, by PRD-V2 §14. The
   artefact the system protects is the `generated_documents` row (its
   `reference_code`/`state_hash`), not the file; `/verify/<code>` recomputes
   from that row regardless of which browser rendered the printout. Byte-
   identical output across browsers, which is pdfme's actual selling point,
   buys nothing on top of that. Pulling in pdfme now would mean replacing
   working, load-bearing code with a heavier dependency to solve a problem
   this design already argued doesn't apply. Not revisiting unless the
   captain has a concrete reason `window.print()` is failing in practice.

   What *was* a real gap: `can_print()` had a grant to `authenticated` and
   was fully correct (verified live — it stays `false` even after forcing a
   request to `status = 'approved'` in a rolled-back transaction, because it
   also checks unmet required tasks in approval stages) but was never called
   from the frontend. Fixed: `documents.ts` now exports `canPrint()`,
   `DocumentView.tsx` calls it alongside `renderDocument()` and disables
   Print/Save-as-PDF until it returns true, with a tooltip explaining why.

   The `can_read_signature()` looseness this paragraph used to flag as still
   open is fixed — see `0035` in §4.
4. Then the questions in §9, and the gaps in §8 that turn out to matter.

---

## 11. Dark mode and the DESIGN.md rewrite — done

Superseded by a more specific ask: not `sd.srmist.edu.in`, but frappe-ui's
own published design tokens, native light/dark, with the whole component
library repainted from them. Done this session — see `DESIGN.md` (fully
rewritten) and §13 below for the mechanics. The print/document question
this section used to flag is answered the way it anticipated: `.doc-sheet`
stays paper-white regardless of app theme, documented in `DESIGN.md`'s
"Two deliberate exceptions".

Still open from the old version of this section: the §8 CSS findings this
hasn't touched, and any `0.9rem`-style literal that isn't one of the
documented type-ramp steps. The retheme repainted tokens; it didn't audit
every inline style for one.

---

## 12. Where to read what

| Document | What it is | Trust |
|---|---|---|
| `HANDOFF.md` | this file — state of the project, V3 in progress | Current |
| `V3-WORKFLOW.md` | the stages/tasks layer: design, decisions, every verification | Current, authoritative on the workflow — except §2.5's pdfme recommendation, which predates `DocumentView.tsx` and was decided against, see §10 item 4 |
| `PRD.md` | v1 product definition | Current |
| `PRD-V2.md` | v2 design, decisions D-1..D-6, open questions | Current |
| `ARCH.md` | the live v2 schema and why it is shaped that way, `0001`–`0029` | Current on structure; doesn't yet mention `0030`–`0035` (bug fixes, RLS narrowing, hardening passes, one new table for signature grants — not a structural schema change) |
| `NOTE.md` | dated decision and incident log, with reasoning | Current, authoritative on "why" |
| `TASK.md` | build tracker, known gaps | **Stale** — dated 2026-08-11, "v1.0.0", predates V2's close. Several items it flags as open (custom fields) are done; some it doesn't mention (attachments UI) are still gaps. Read `HANDOFF.md` §8 instead. |
| `SECURITY.md` | threat model, risk register R-01..R-32 | Current |
| `DEPLOY.md` | deployment runbook, Part C covers host rebuild | Current, battle-tested |
| `DESIGN.md` | the frontend's visual system | Current — rewritten this session for the frappe-ui retheme and dual-theme, see §11/§13 |

---

## 13. Five Bencho components (this session) — what's vendored, what's wired, what isn't verified live

`bencho.dev`'s MIT-licensed component library, requested one at a time and
built faithfully (comments kept, as asked) under
`app/src/components/bencho/`. Tokens mapped once, locally, in
`app/src/bencho.css` — `--font-ui`/`--ink` already exist under those exact
names in this app's own system; `--card`, `--board`, `--bg`, `--pane`,
`--pane-edge`, `--ok`, `--signal`, `--ink-2..5` are aliased to the nearest
existing token on `.upl`/`.otp`/`.sld`/`.sek`/`.crt-stage`'s own root rule,
not promoted to `:root`. The `-rgb` tokens (`--ink-rgb`, `--fill-on-rgb`)
are literal sRGB triplets computed from the real oklch ink tokens (light
`23 23 23`, dark `248 248 248`), with their own `[data-theme="dark"]` /
`prefers-color-scheme` pair, since oklch has no CSS-native RGB decomposition
to alias from. Dropped, deliberately: the two components' `data-fill="..."`
dark-mode overrides (that attribute is never set anywhere in this app) and
Seek's frosted-glass `backdrop-filter` (nothing to blur against — `--pane`
resolves to opaque `--paper`).

**Two of the five were decorative demos, not functional ones, as shipped —
flagged before building anything, not discovered after:**

- **Upload dropzone.** The vendored `UploadDropzone.tsx` is kept as given —
  its own header comment says `NO REAL FILES`, and it drags one of two
  hardcoded fake tiles into a box with a simulated progress fill. The real
  one the app actually uses is `BasecampUpload.tsx`, same box/motion
  language, wired to a native file input + drag-and-drop and
  `attachments.ts`'s real `uploadAttachment()`. No fake percentage — Supabase
  storage's `upload()` wraps `fetch`, which exposes no progress events, so
  this shows "Uploading…" rather than inventing a number. Restricted to
  PDF/DOC/DOCX/PPT/PPTX/PNG/JPG/WEBP/GIF per the captain's list, checked by
  MIME type with an extension fallback (some browsers send `application/
  octet-stream` for a `.docx` dragged from certain sources). Wired into
  `Attachments.tsx`, replacing the old plain "Attach a file" button.
- **One-time code.** The vendored source took a fixed `answer: "Accept" |
  "Reject"` prop — a demo for the wall, not a real check. Adapted to take
  `onSubmit: (code) => Promise<...>`, wired straight into `VerifyMfa.tsx`'s
  existing `verifyTotp()` — same real Supabase MFA challenge as before, just
  behind the fuse-into-a-capsule animation instead of a plain input+button.
  **Verified live**: typed a wrong code against a real account, got the
  real `Invalid TOTP code entered` error back from Supabase, watched the
  row shake and drain. The enrollment QR/secret display (a separate,
  unrelated piece of this same screen) is untouched.

**The other three also needed real adaptation, not just token-mapping:**

- **Slide to confirm.** The vendored demo commits the instant the handle
  crosses the mark — nothing to wait on. Wired into the Approve button on
  `RequestsPage.tsx`'s request-detail footer (replacing the plain `btn
  btn-success`, **only** there — the captain was explicit this is for
  confirm actions, not every submit button), the handle now holds at the
  wall and calls the real `decideRequest(id, 'approved', note)` RPC; only a
  real resolve plays the "Confirmed" morph, a reject (outstanding tasks, a
  stale decision, anything RLS refuses) springs the handle back and surfaces
  the message the same way every other action's error already does. A
  request still carrying outstanding required tasks shows the old disabled
  button instead of the slider — sliding doesn't bypass that gate, it's
  just not rendered when there's nothing to slide toward yet. **Not yet
  clicked through live** — needs a request at that exact state and a
  session past MFA, neither available this session (see below).
- **Search ("Seek").** The vendored demo owns its own `value` internally.
  Made optionally controlled (`value`/`onChange` props, falls back to
  internal state when omitted) so it could drive the existing
  `forwardQuery`/`searchForwardTargets` debounce already in
  `RequestsPage.tsx`, replacing the plain `.form-input` "Forward to" box —
  the "search for a role who might be intermediate in the request" the
  captain asked for. None of the open/shut spring or magnet-hover geometry
  touched.
- **Create menu.** The vendored demo's four menu rows (Document,
  Spreadsheet, Board, Folder) are a fixed `ITEMS` constant sized for exactly
  four. This app's "create" action is "raise a request in category X", and
  the category list is whatever the captain configured on Workflow — so
  `items`/`onPick` are props now, and the panel's height is derived from
  the real item count (`items.length * 34px + gaps + padding`) instead of a
  hardcoded 166px for four rows. An empty category list shows "No
  categories configured yet" rather than an empty panel. Replaces the plain
  "+ New request" button on `RequestsPage.tsx`; picking a category opens
  `NewRequestModal` with it pre-selected (`initialCategoryId`, new prop)
  instead of landing on the modal's own category dropdown at nothing
  selected.

**Not verified live, and why**: beyond the OTP reject path above, nothing
in this section was clicked through in a real browser. Every session
reachable this turn hit the TOTP re-entry screen with no code to give it —
GOWTHAM's token from an earlier session had long since expired, and no
fresh session was available. Everything here is build-verified
(`npm run build` clean after every component) and the wiring was read
carefully against the real RPCs it calls, but "Slide to approve" against a
real outstanding-tasks request, "Create" against a real category list, and
the upload dropzone's real multipart path through `storage-api` all still
need a non-captain login to actually watch happen, same gap §10 already
tracks for the pre-existing task/participants UI.

Bundle cost: `framer-motion` (new dependency, used by Upload/SlideConfirm/
CreateMenu) took the gzipped bundle from ~171KB to ~226KB. Worth knowing,
not currently worth undoing — these are real, requested interaction
patterns, not decoration pulled in for its own sake.

---

## 14. LabelInput, and a navigation restructure (this session, follow-up)

**Sixth Bencho component**: `LabelInput.tsx` (`app/src/components/bencho/`),
the field-whose-label-becomes-its-placeholder-until-focused pattern.
Adapted from the vendored demo (which was uncontrolled, and picked
`email`/`password` from the label text) to take `value`/`onChange`/`type`
as normal props, and wired into `LoginForm.tsx` in place of the two plain
`.form-input`s. **Verified live**: typed into the email field, watched the
label lift with the per-letter hop and the outline gap open, on the real
frozen-light auth screen.

Its `--ink-rgb` needed a second override: `.auth-wrapper`'s freeze (see §13)
covers every token the pre-existing primitives read, but `--ink-rgb` is new
with this component and a plain `.auth-wrapper .lbi` rule loses to the
dark-mode bridge's `:root[data-theme="dark"] .lbi` on specificity regardless
of source order (a directly-targeted rule always beats an inherited custom
property value). Matched at equal specificity instead
(`:root .auth-wrapper .lbi`), relying on source order for the tie — see the
comment in `bencho.css`.

**Navigation restructure**, the other half of the same request:

- **The rail collapses.** `.rail[data-collapsed]` — frappe-ui's Sidebar
  collapses to an icon rail rather than hiding navigation behind a
  hamburger on desktop, which has the room for it; this app's rail was a
  fixed 15rem with no collapse at all, the thing called out as "harder for
  people to change." State persists in `localStorage['sidebar-collapsed']`,
  toggled from a new button in the rail's footer.
- **"Account" is gone from the nav list.** Profile, password, MFA
  enrollment, and the appearance toggle all still live in `AccountPage.tsx`
  — unchanged — but it's no longer a routed `/account` destination. A
  "Settings" trigger (gear icon, in the rail footer on desktop, in the
  launcher's grid on mobile) opens it inside the existing `Modal` component
  instead. `AppShell` owns this state now (`onProfileChanged` is a new
  required prop, threaded from `App.tsx`'s `bootstrap`); `App.tsx`'s
  `/account` route render is deleted, though the route name stays valid in
  the `Route` union in case anything still constructs it — bootstrap's
  `allowed.includes(fromPath)` check already sends a stale `/account`
  deep-link to the first real tab instead of erroring.
- **"New request" is a floating button**, not a page-header button —
  `.new-request-fab`, `position: fixed`, bottom-right on every screen size.
  On mobile it sits above the launcher dock (`bottom: 4.5rem` + safe-area)
  rather than under it; desktop drops to a plain `var(--sp-5)` corner
  offset. Still scoped to `RequestsPage.tsx` specifically, not lifted to
  `AppShell` — it's only reachable while on the Requests page, not from
  Dashboard or anywhere else. Lifting it further (so it floats on every
  page) would mean moving `NewRequestModal` and its category-loading state
  out of `RequestsPage` entirely; flagged here rather than guessed at.

**Caught while wiring Settings through the mobile launcher**: `.launcher`'s
z-index (60) sat above `.modal-overlay`'s (50), so opening Settings from
the launcher's footer — which closes the launcher and opens the modal in
the same click — would show the modal hidden behind the launcher's own
240ms close animation. Raised `.modal-overlay` to 65, above every other
overlay in the app; a modal should always be the topmost layer regardless
of what opened it.

**Not verified live**: everything in this section past the login screen.
Still no working TOTP code for any account this session (see §13's same
note) — the collapsed rail, the Settings modal reachable both ways, and
the floating "New request" button are all build-verified and read back
carefully, not clicked through.

---

## 15. First real live verification pass (this session) — what actually got clicked through

A real session JWT (GOWTHAM/HOD, aal2) finally made it possible to click
through everything §13/§14 had only build-verified. Logged in, drove the
real app against real data (two real approved requests, one real
pre-existing attachment from another uploader), signed out cleanly after.

**Confirmed working, no changes needed:**
- Collapsible sidebar — expand/collapse toggles correctly, icon-only state
  renders right, no navigation side effects on the actual toggle action.
- Settings modal — opens from the rail footer, shows real profile data,
  the theme toggle switches the *entire app* (sidebar, page, modal itself)
  to dark instantly, no flash, no stale light patches anywhere.
- Requests list, real data, dark mode throughout.
- Attachments: the existing real file from another uploader shows with no
  delete button (correct — uploader-only); BasecampUpload's dropzone
  renders and accepts a real upload; a `.txt` was correctly refused (not
  on the allow-list) before a properly-named `.pdf` was tried.
- Attachment delete, full round trip: uploaded a disposable test file as
  myself, trash icon appeared only on my own row, two-click confirm
  worked, the file disappeared from the list and the other uploader's
  real file was untouched. Cleaned up immediately after — this was a live
  test file, not left behind.
- The floating "New request" button and the Create menu: expands to show
  the real category list, picking one opens `NewRequestModal` with that
  category already selected (not landing on an empty dropdown).

**Found and fixed live — a real bug, not a guess:** the Ticket view's QR
code was in the DOM with a correct, valid image the whole time — just
entirely invisible. `.ticket-stub-text` had no `min-width: 0`, so the
32-character unbroken reference code forced the flex row wider than the
card, and `.ticket { overflow: hidden }` clipped the QR clean off the
right edge — confirmed by reading `getBoundingClientRect()` directly:
the image's box was sitting almost entirely past the ticket's own right
boundary. Fixed (`min-width: 0`, stacked instead of side-by-side, the
reference code allowed to wrap) and reconfirmed live: the QR renders
inside the card now, reference code wraps to two lines instead of
pushing anything out. This is exactly the class of bug that no amount of
"read the CSS carefully" catches — the element was correct, present, and
genuinely off-screen.

**Fixed per direct correction:** Slide-to-approve was showing on every
screen size. The captain's correction: it's for small screens specifically
— the gesture a thumb does, not a cursor. `useMediaQuery` already existed
(auth screen's panel breakpoint); added `SMALL_SCREEN_QUERY` alongside it
(`max-width: 48rem`, matching components.css's existing "character shift"
breakpoint) and branched the Approve button: slider below it, the original
plain button at and above it. Confirmed live that `smallScreen` correctly
evaluates `false` on a real desktop-width session — the actual slider
toggle couldn't be clicked because no request was awaiting this account's
decision at the time, and the automation environment's `resize_window`
didn't actually resize this particular browser window (`window.innerWidth`
stayed 1920 after the call), so the narrow-viewport branch itself is
still unclicked, just correctly absent at desktop width.

**Deliberately not tested, and why:** the receipt-printer submission
animation needs a real `submitRequest()` call — tested by code review and
build only, not clicked, because the only way to trigger it live is
raising a real request against a real organisation's live category/
routing config, which is real clutter in someone else's data, not a
disposable test the way an attachment upload is. Flagged rather than
done, same as the no-fixture-data rule applies everywhere else in this
project.
