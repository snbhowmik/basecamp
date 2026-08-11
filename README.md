# Basecamp

A self-hosted, instantiable request and ticketing platform. On-Duty (OD)
requests are the first thing it's configured to handle — the way a ticket
type is configured in a helpdesk tool — not something built into the code.

> Naming note: "Basecamp" is also an existing commercial product (37signals).
> Fine for internal use; worth reconsidering before any public release.

## Foundation

Self-hosted Supabase (Postgres + GoTrue + PostgREST + Realtime + Storage)
on a single VPS, with [Garage](https://garagehq.deuxfleurs.fr/) as
self-hosted S3-compatible object storage on a separately attached,
growable volume — not the VPS boot disk.

This gives `auth.uid()`-based Row Level Security as the real authorization
boundary (not a custom-built authorization layer), and native TOTP MFA,
without running Keycloak or writing an auth service from scratch.

## What actually needs permanent storage

Only one thing: **student-uploaded certificates and achievements.**
Everything else that looked like a storage problem earlier in this
project's design turned out not to be:

- Parent consent is a verified record (mentor calls, confirms, checks a
  box) — never a scanned document.
- Official documents (Annexure 4.4, an NOC) are generated on demand from
  data already in the database plus a stored signature image. The PDF is
  a cache; it can be regenerated identically at any time.
- OD evidence attachments (posters, letters, receipts) are purged
  automatically a week after the HOD closes the ticket following event
  review — they only mattered while the request was active.

## Repository Layout

```
docker-compose.yml       — the full self-hosted stack
kong.yml                 — gateway routing + CORS
garage/garage.toml       — object storage config
supabase/migrations/     — schema, functions, RLS (run in order — see DEPLOY.md)
supabase/seed.sql        — DEMO/REFERENCE ONLY, never for a real deployment — see below
scripts/                 — bootstrap-db-roles.sh, apply-migrations.sh (see DEPLOY.md)
app/                      — the frontend (Vite + React + TS)
.env.example             — copy to .env, fill in, never commit
ARCH.md                  — architecture and data design, matches the actual code
NOTE.md                  — decisions, hurdles, gotchas — dated log, read before assuming
TASK.md                  — build tracker, what's actually in the repo vs. planned
SECURITY.md              — threat model, risk register, pre-production test plan
DEPLOY.md                — full build-from-scratch + VPS deployment walkthrough
```

For the full step-by-step (local dev through VPS go-live), see **DEPLOY.md**
— the quickstart below is the short version.

## Running It

```bash
cp .env.example .env
# fill in .env — see comments in the file for how to generate each secret,
# including real SMTP (GOTRUE_MAILER_AUTOCONFIRM is "false" — no SMTP means
# no one, including the wizard's own captain account, can ever confirm a
# signup)

docker compose up -d db
# wait for it to report healthy — `docker compose ps`

./scripts/bootstrap-db-roles.sh
# one-time: sets the password on authenticator/supabase_auth_admin/
# supabase_storage_admin, which supabase/postgres's own init scripts create
# but never set a password on (see the script's header comment)

docker compose up -d auth
# wait for it healthy — its own internal migrations create auth.mfa_factors,
# which 0001_schema.sql's triggers depend on

./scripts/apply-migrations.sh
# applies supabase/migrations/*.sql in order. Does NOT touch supabase/seed.sql
# — that file is demo/reference catalog data only, never for a real
# deployment (see its header comment and "No Fixture Data" below)

docker compose up -d
```

Then visit the app (`app/` — `npm install && npm run dev`, pointed at
`http://localhost:8000` via `app/.env.local`) and complete the setup wizard.

First boot: visit the app, and you'll be walked through the setup wizard —
create the **captain** account (the one and only account created outside
the normal in-app flow), enroll MFA, configure allowed login domains, then
lay the org's initial priority levels and first request category. Nothing
else is reachable until that completes.

## No Fixture Data — the Captain Builds the Org By Hand

`supabase/seed.sql` is example/reference catalog data for a throwaway demo
instance only — **never run it against a real deployment.** The wizard
creates exactly one account (the captain) and the structural minimum needed
to boot; every other account and every org-specific structure is created
manually, inside the app, by a human who already holds the right level —
not seeded, not scripted, not faked. This is deliberate: verification for
each of these happens by hand every time, not by trusting fixture data.

That cascade, as the org actually works:

- The **captain** is the only account created by the wizard, and the only
  one who defines priority levels and hands out the `admin` tag itself
  (labeled "Captain" in the UI — see `has_tag('admin')` throughout
  `0002_functions_and_rls.sql` for why the tag *code* stays `admin`). The
  captain can create an account at any level directly, but in practice
  mostly creates the top of each chain and lets it cascade.
- A **Dean** is scoped to one institute (e.g. IST and TRP each have their
  own Dean — these are different people, different accounts) and may hold
  several emails. A department can also have its own Dean. Deans create HOD
  accounts for their departments.
- An **HOD** creates Mentor and Student accounts (and Student Outreach
  Faculty — a distinct staff tag, not a HOD/Mentor variant) for their
  department.

None of this cascading creation UI exists yet — today the wizard only gets
the captain account and the structural minimum onto the board. The
create-account-at-my-level-or-below flow for Dean/HOD/Mentor is follow-up
work, not part of this stage.

## What's Real vs What's Still Design

**Built (this repo):** the schema, the authorization model (RLS + helper
functions), the routing/watcher/purge triggers, the domain-restricted
signup guard, the Docker Compose stack, the frontend scaffold and the
first-boot setup wizard (`app/` — captain account, MFA enrollment, allowed
domains, org bootstrap), verified end to end against a real running stack
(see DEPLOY.md, TASK.md).

**Not yet built:** the request submission/approval flow itself, the
cascading account-creation UI (Captain → Dean → HOD → Mentor/Student), the
PDF generation service for Annexure 4.4/NOC, the signature-cleaning image
pipeline, the scheduled job that actually deletes purged attachments from
Garage (the trigger only marks rows — see `attachments_pending_purge`),
and the offsite backup sync job. Full list in TASK.md.

## A Note on the Authorization Model

Every relationship check ("is this person the HOD of this student's
department?") is written once, as a `security definer` SQL function in
`0002_functions_and_rls.sql`, and every policy that needs it calls that
function rather than repeating the join. If you're adding a new policy
and you find yourself writing a multi-table join to check a relationship
— stop, check whether a helper function for that already exists, and add
one if it doesn't. This is the single most important convention in the
codebase for keeping the authorization model correct as it grows.

## Storage Durability

Garage on a single VPS has no built-in replication (`replication_mode =
"none"` in `garage.toml`) — that's a deliberate tradeoff for self-hosting
at this scale, not an oversight. It means the encrypted offsite backup
(R2/B2, configured via `BACKUP_S3_*` in `.env`) is not optional — it's
the only thing standing between a disk failure and losing every student's
certificates. **Test the restore path before this goes anywhere near real
data.** See SECURITY.md.

---

## V2 — Planned Extensions (design notes, not yet built)

Captured here as the operator described it directly, before implementation
starts. Nothing below is built yet — this is the brief, not a changelog.
**Load-bearing constraint, stated explicitly by the operator: this is a
ticketing platform, not a single-institution script — departments, batches,
tags, and levels must stay admin-configurable and extensible, never baked
into code or migrations as fixed values.** Every part of this design has to
honor that or it's wrong.

### Two signup paths, not one

This refines the "invite-only once the captain exists" gate shipped in
`0004_account_provisioning.sql` — that migration currently requires *every*
signup to match a `pending_assignments` invite. V2 splits this in two:

- **Public self-registration portal** — open to anyone on an allowed
  domain, same as the original domain-restricted-signup model. **Creates
  student accounts only, by default.** At signup, the student picks their
  **department** and **batch** from dropdowns (see below) — this selection
  UI appears *only* on this student-facing signup form, not anywhere else.
- **Staff/faculty — invite-only, never through the public portal.** An
  authorized inviter (Captain/Dean/HOD, per the existing rank-based
  `can_invite()` rule) sends an invite; the invitee receives a unique URL
  plus an OTP code in their inbox. Completing that flow runs them through
  the *same onboarding the captain went through* — set password, mandatory
  MFA enrollment — before they land in the app. This is the existing
  `pending_assignments` mechanism from `0004`, just gated behind a
  dedicated link+OTP rather than "sign up normally and get matched."

Open question this raises, to resolve before building: does the public
portal reuse `check_allowed_domain()`'s domain gate with the invite
requirement dropped *only* for student-shaped signups, or does it need a
distinct signup entry point entirely? Leaning toward the former (keeps one
signup form, one code path) but worth deciding deliberately, not by default.

### Departments and batches — extensible, not fixed

Initial departments (captain can add more at any time, same as today's
department model):

- Computer Science and Engineering (CSE)
- Computer Science and Engineering — Cyber Security (CSE-CS)
- Computer Science and Engineering — Artificial Intelligence and Machine
  Learning (CSE-AIML)
- Computer Science and Engineering — BioTech (CSE-BT)

**Classes are batches**, not sections — a class is one department's intake
year-range (e.g. "CSE 2023–2027", "CSE-CS 2024–2028"), matching the
existing `classes(name, year, department_id)` shape reasonably well
already. Captain can add new batches as new intakes start (2026 batch and
onward) — this must stay data, never a hardcoded year list.

### Staff/faculty account page

Every account (not just the captain) gets an **Account** page — profile
details, and critically, a way to **regenerate/reset their TOTP MFA
enrollment** if they lose their authenticator (currently there is no
recovery path from a lost authenticator at all — a real gap for anyone
past the captain).

### Navigation, by who's signed in

- **Captain:** Workflow, Dashboard, Invite, Account Overview — more to
  come as the platform grows. Captain's dashboard surfaces "important
  users" by default (exact definition of "important" — recent signups?
  pending approvals awaiting the captain specifically? — still open).
- **Everyone else:** Dashboard, Request, Account (profile + MFA
  reset/regenerate).

### Open questions for this phase (operator invited these — real app, ask rather than assume)

1. Public signup path: reuse the domain-check trigger with a student-only
   carve-out, or a genuinely separate entry point?
2. "Important users" on the captain's default dashboard — what makes a
   user surface there?
3. Batch naming convention — is `"2023-2027"` the canonical `classes.name`,
   or is year-range derived from `classes.year` + a fixed program length
   (4 years) and displayed, not stored as a string?
4. Staff invite link — a dedicated one-time-token route (e.g.
   `/invite/<token>`), or the OTP-to-inbox flow alone, with no separate
   token in the URL at all?
5. "Workflow" page (captain nav) — is this category/routing configuration
   (request types, first-hop pickers — PRD §8–9), or something else?

---

## How This Actually Got Deployed — Context for Future Sessions (Human or AI)

This section exists so a fresh session — human or AI — picking this repo
back up doesn't have to rediscover what already went wrong once. Full
detail lives in **DEPLOY.md** (the runbook) and **NOTE.md** (dated,
one-entry-per-incident log); this is the condensed narrative.

**What was built, in order:** the schema and RLS (`0001`–`0003`), a Vite/
React frontend (`app/`) with a first-boot setup wizard, then cascading
account provisioning (`0004`) — all designed and reviewed before ever
touching a live server.

**Then it was actually run against a real docker-compose stack**, not just
read for correctness — and that surfaced a chain of real, non-obvious
infrastructure bugs that code review alone would never have caught:
migration ordering versus GoTrue's own internal migrations, Postgres role
passwords the base image never sets, `postgres` not being `SUPERUSER` in
this image (`supabase_admin` is), an RLS `SELECT` policy silently blocking
an `INSERT ... RETURNING`, `SECURITY DEFINER` functions needing a pinned
`search_path` when triggered from a different role's session, GoTrue
issuing an empty JWT role claim without two specific env vars, and no CORS
plugin in Kong (invisible to `curl`, fatal in a real browser). Every one of
these is a dated entry in NOTE.md with its actual fix.

**Then it was deployed for real** — a DigitalOcean VPS, Cloudflare Tunnel
(no inbound port open at all beyond SSH), self-hosted Mailcow for SMTP,
Garage for object storage with a real bucket/key provisioned. That surfaced
a second wave of issues, this time from things you only see once DNS,
email, and a real browser are all in the loop simultaneously: GoTrue's
`API_EXTERNAL_URL` needing the `/auth/v1` suffix (confirmation links 404'd
without it — fixed by also adding direct OTP-code entry as a
link-independent fallback), a duplicate Kong route from a git-sync mixup,
and — twice — the Postgres role passwords drifting out of sync with `.env`
after the database was reset, which was eventually traced to leftover
inconsistent state from the very first crash-looping attempts rather than
anything wrong with the reset procedure itself; the fix both times was a
full clean volume wipe and a from-scratch, every-step-verified rebuild
rather than another targeted patch.

**The operating principle that made this tractable:** verify against the
real running system at every step — `docker compose logs`, actual `curl`
calls against the public domain, pasted terminal output — rather than
trusting "that should work now." Several of the bugs above produced a
plausible, individually-fixable-looking error that turned out to have a
different real cause underneath once actually checked. A future session
should keep doing this: prefer running the thing and reading the real
error over reasoning from what the code *should* do.
