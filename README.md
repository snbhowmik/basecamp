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
