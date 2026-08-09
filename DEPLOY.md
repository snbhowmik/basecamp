# DEPLOY — Build From Scratch, Then Ship to a VPS
**Basecamp v1.0.0**
**Last Updated:** 2026-08-09

> This is the sequence that was actually run against a real docker-compose
> stack to get the setup wizard working end to end — not a theoretical
> checklist. Every step in Part A was live-verified (see NOTE.md's
> 2026-08-09 entries for what broke and why). Part B extends the same
> sequence onto a real VPS; the parts specific to a VPS (Garage bucket
> provisioning, Cloudflare, offsite backups) follow documented, standard
> practice for these tools but were **not** live-tested in this pass — the
> Known Gaps note in TASK.md says exactly which parts those are. Don't
> assume Part B works byte-for-byte until you've run it once.

---

## Part A — Build From Scratch (Local)

### A.0 Prerequisites

- Docker + Docker Compose v2
- Node.js 20+ (for `app/`, and for generating JWTs — see A.2)
- `openssl` on your PATH

### A.1 Clone and lay out the repo

```bash
git clone <this-repo> basecamp && cd basecamp
```

Expected layout (this is what `docker-compose.yml` and the scripts assume):

```
docker-compose.yml
kong.yml
garage/garage.toml
supabase/migrations/0001_schema.sql
supabase/migrations/0002_functions_and_rls.sql
supabase/migrations/0003_wizard_rls.sql
supabase/seed.sql          — demo/reference only, see its header. Do not run on a real deploy.
scripts/bootstrap-db-roles.sh
scripts/apply-migrations.sh
app/                        — the frontend (Vite + React + TS)
```

### A.2 Generate secrets

```bash
cp .env.example .env
```

Fill in `.env`:

| Var | How to generate |
|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `JWT_SECRET` | `openssl rand -base64 48` |
| `ANON_KEY` / `SERVICE_ROLE_KEY` | `node scripts/gen-jwt.cjs "$JWT_SECRET"` — HS256 JWTs carrying `{"role":"anon"}` / `{"role":"service_role"}`. **Verify before trusting them:** `node scripts/verify-jwt.cjs "$JWT_SECRET" "$ANON_KEY"` — a token signed with a different secret than what ends up in `.env` looks completely normal (decodes fine, right claims) but fails every request with a signature error that gives no hint the secret is the problem. This happened once in this session from a shell quoting mismatch — cheap to check, expensive to debug blind. |
| `SITE_URL` | Where the frontend will actually be served — `http://localhost:5173` for local dev, your real domain in production. This is also used for GoTrue's `API_EXTERNAL_URL` (see `docker-compose.yml`'s comment on why that's unprefixed). |
| `SMTP_*` | Real SMTP is required — `GOTRUE_MAILER_AUTOCONFIRM` is `"false"`, so no SMTP means no one can ever confirm a signup, including the wizard's own captain account. Self-hosted Mailcow on your own domain works fine (standard Postfix/Dovecot, exposes normal SMTP submission on 587) — get SPF/DKIM/DMARC right on that domain first. For **local dev only**, see A.7. |
| `GARAGE_RPC_SECRET` / `GARAGE_ACCESS_KEY` / `GARAGE_SECRET_KEY` | `openssl rand -hex 32` / `openssl rand -hex 12` / `openssl rand -hex 24` |
| `REALTIME_SECRET_KEY_BASE` | `openssl rand -base64 64` |
| `REALTIME_DB_ENC_KEY` | `openssl rand -hex 16` |
| `BACKUP_S3_*` / `BACKUP_ENCRYPTION_KEY` | Only needed once you're doing the offsite backup (Part B, §B.6). Leave blank for local dev. |

### A.3 Bring up the database, and only the database

```bash
docker compose up -d db
docker compose ps db   # wait for "healthy"
```

Don't bring up anything else yet. `db`'s own `docker-entrypoint-initdb.d` scripts (baked into the `supabase/postgres` image) create the `anon`/`authenticated`/`authenticator`/`supabase_*` roles and schemas on first boot — the next two steps depend on that being finished.

### A.4 Fix the two things the base image leaves broken

```bash
./scripts/bootstrap-db-roles.sh
```

Sets a password on `authenticator`/`supabase_auth_admin`/`supabase_storage_admin` — the base image creates these roles but never sets `POSTGRES_PASSWORD` on them, even though every connection string in `docker-compose.yml` assumes they share it. Without this, `auth`/`rest`/`storage` all fail SASL auth against a fresh instance. See NOTE.md for the full story, including why this has to connect as `supabase_admin` and not `postgres` (`postgres` isn't `SUPERUSER` in this image).

### A.5 Bring up `auth`, and only `auth`

```bash
docker compose up -d auth
docker compose ps auth   # wait for "Up", check logs for "GoTrue API started"
docker compose logs auth --tail 20
```

GoTrue runs its own internal migrations on first connect — this is what creates `auth.mfa_factors` and the rest of the `auth` schema. **This has to happen before the next step**, because `0001_schema.sql` creates a trigger on `auth.mfa_factors` — see NOTE.md's first BLOCKER entry for what happens if you get this order wrong (short version: it doesn't just fail cleanly, it takes down the base image's own role bootstrap with it).

### A.6 Apply our own migrations

```bash
./scripts/apply-migrations.sh
```

Applies `supabase/migrations/*.sql` in order (`0001`, `0002`, `0003`), each as `supabase_admin`. Does **not** touch `supabase/seed.sql` — see README.md "No Fixture Data" for why a real deployment never runs that file.

### A.7 Bring up the rest of the stack

```bash
docker compose up -d
docker compose ps
```

Everything should show `Up` (Studio may show `unhealthy` — it depends on a few things not wired up yet and isn't required for the wizard; see TASK.md). If anything is crash-looping, check `docker compose logs <service> --tail 30` and cross-reference NOTE.md's 2026-08-09 entries — the ones this session hit (missing `SECRET_KEY_BASE`/`DB_ENC_KEY`/`FLY_APP_NAME` for realtime, missing `PGRST_JWT_SECRET` for storage, missing CORS plugin in Kong) are already fixed in the committed `docker-compose.yml`/`kong.yml`, but if you're on a different image version some of these env var names may have moved again.

**Local dev without real SMTP:** if you don't have a real SMTP server reachable from your dev machine yet, you have two options:
1. Point `SMTP_HOST` at a local mail catcher that supports STARTTLS (GoTrue's mailer refuses to send over an unencrypted connection to anything that doesn't resolve as `localhost`). Plain Mailhog doesn't speak TLS at all — this was tried and abandoned in this session as not worth the time (see NOTE.md).
2. Temporarily set `GOTRUE_MAILER_AUTOCONFIRM: "true"` in `docker-compose.yml`, recreate `auth` (`docker compose up -d auth`), test, then **revert to `"false"` before committing anything**. This is what was actually used to verify the wizard end to end in this session.

### A.8 Run the wizard

```bash
cd app
cp .env.example .env.local
# VITE_SUPABASE_URL=http://localhost:8000
# VITE_SUPABASE_ANON_KEY=<your ANON_KEY from ../.env>
npm install
npm run dev
```

Visit `http://localhost:5173`. You should land on **Step 1 of 4 — Create the captain account**, not a login screen (if you see a login screen on a supposedly-fresh instance, either the wizard already ran, or the browser has a stale session from an earlier attempt — `localStorage.clear(); sessionStorage.clear()` in the browser console, then reload).

Walk through all 4 steps. Step 2's QR code needs an actual authenticator app (or compute the TOTP code yourself from the manual-entry secret — any standard TOTP implementation, 30-second window, SHA1, 6 digits). At the end you should land on a bare dashboard shell as the captain.

### A.9 Verify it actually locked down

```bash
ANON_KEY=$(grep ^ANON_KEY .env | cut -d= -f2)
curl -s -i -X POST "http://localhost:8000/rest/v1/priority_levels" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" -d '{"rank":99,"name":"Intruder"}'
```

Expect `401` with `"new row violates row-level security policy"`. If this succeeds, something is wrong — the bootstrap window should have closed the moment the captain's `admin` tag was granted in step 4.

---

## Part B — VPS Deployment

Everything in Part A applies here too — same sequence, same scripts. This section is what's different about a real VPS: provisioning, network exposure, storage durability, and going live for real. **The steps in §B.4 (Garage) and §B.6 (offsite backup) are standard practice for these tools but were not live-tested in this session** — verify them yourself before trusting them with real data (see TASK.md's Known Gaps).

### B.1 Provision the VPS

- A provider that supports attaching a separate, independently growable block volume — the whole point of self-hosting Garage instead of using it as a thin wrapper over the boot disk (see ARCH.md §6.1, NOTE.md's Garage-vs-R2 decision). Provider/region/specs is still an open question per SECURITY.md §7 — pick one that supports this before anything else.
- Ubuntu LTS (or your preferred distro with a maintained Docker package) — root or sudo access.
- A domain, with DNS delegated to Cloudflare.

### B.2 Harden the host before anything else touches it

- SSH key-only auth, disable password auth
- A non-root user with sudo, for everything below
- `ufw` (or equivalent) — deny all inbound except SSH and whatever port Cloudflare needs; Kong is the *only* container that should ever be reachable, and only via Cloudflare in front of it, never directly (see SECURITY.md R-11, R-12)
- Unattended security upgrades
- `fail2ban` on SSH
- Install Docker + Docker Compose v2

Attach the growable block volume now, mount it, and set `GARAGE_DATA_HOST_PATH` in `.env` to that mount point (e.g. `/mnt/basecamp-data-1001` on DigitalOcean) — **not** the boot disk. `docker-compose.yml`'s `garage` service bind-mounts this directly rather than using a Docker-managed named volume, specifically so it's guaranteed to land on the attached volume and not silently default to the boot disk's Docker data root.

### B.3 Transfer the repo, run Part A's sequence

Same steps as A.1–A.9, on the VPS, with real production secrets in `.env` (not the local-dev shortcuts from A.7's SMTP workaround — real SMTP from the start; there's no reason to autoconfirm on a production instance). `SITE_URL` is now your real domain.

### B.4 Garage: bucket and access key provisioning

**Not verified in this session — follow Garage v1's own docs closely, this is a summary, not a substitute.** After `garage` is up:

```bash
docker compose exec garage /garage node id
# then, for a single-node layout:
docker compose exec garage /garage layout assign -z dc1 -c <capacity> <node-id>
docker compose exec garage layout apply --version 1

docker compose exec garage /garage bucket create basecamp-files
docker compose exec garage /garage key create basecamp-storage-key
docker compose exec garage /garage bucket allow --read --write --owner basecamp-files --key basecamp-storage-key
```

Match the resulting access key ID/secret to `GARAGE_ACCESS_KEY`/`GARAGE_SECRET_KEY` in `.env`, matching what `storage` service's `S3_PROTOCOL_ACCESS_KEY_ID`/`_SECRET` in `docker-compose.yml` expect. Also note: `garage/garage.toml`'s `rpc_secret` is currently a **hardcoded placeholder string**, not actually substituted from `GARAGE_RPC_SECRET` (flagged in TASK.md) — harmless for single-node since RPC only matters for clustering, but fix this before ever adding a second Garage node.

### B.5 Cloudflare

- DNS: proxied (orange-clouded) record pointing at the VPS
- TLS: Full (Strict) — Kong itself doesn't terminate TLS; either front it with a Cloudflare Tunnel (`cloudflared`, no inbound port needed at all) or a reverse proxy on the box that Cloudflare's proxied traffic reaches. Cloudflare Tunnel is the simpler, more locked-down option — it means the VPS doesn't need port 8000 (or any port) open to the internet at all, only outbound to Cloudflare.
- Rate limiting rules in front of `/auth/v1/*` at minimum (SECURITY.md R-09)

### B.6 Offsite encrypted backup — go-live gate, not optional polish

Per ARCH.md §6.2 and SECURITY.md R-14/R-21/R-22: single-node Garage has `replication_mode = "none"` — a disk failure on the attached volume loses every certificate, permanently. The offsite backup to R2 or B2 is the only thing standing between that and actually losing data.

- `BACKUP_S3_*` in `.env` — endpoint, access key, secret, bucket, all for the **backup destination**, not live storage
- `BACKUP_ENCRYPTION_KEY` — generate separately, and **do not store it on this VPS**. A password manager or a separate secrets service, per SECURITY.md R-22 — if the encryption key lives next to the thing it protects, the backup is worthless the moment the VPS itself is compromised or destroyed.
- Wire up the actual sync job (not yet built as code in this repo — cron + `rclone`/`restic` or similar, encrypting before it leaves the box)
- **Then run a full restore to a clean host and confirm it actually works.** A backup that's never been restored is a hypothesis, not a backup (ARCH.md §6.2). This is listed as test #10 in SECURITY.md's pre-production test plan and is a hard go-live gate — do not skip it, do not treat "the sync job runs without erroring" as equivalent to "the restore works."

### B.7 Run the wizard for real

Same as A.8, against your real domain. This is the one and only account created outside the normal flow — the captain. Everything else (Deans, HODs, Mentors, Students, Student Outreach Faculty) gets created by hand, inside the app, by someone who already holds the right level — see README.md "No Fixture Data."

### B.8 Before calling this live

Run SECURITY.md §6's pre-production test plan in full — it's the authoritative checklist, not duplicated here. At minimum, don't skip:

- Test #1 (cross-user `SELECT` sweep) and #3 (student can't self-grant tags/levels) — the core of what RLS is supposed to prevent
- Test #5 (sensitive write with `aal1`, no MFA, must be denied)
- Test #10 (backup restore to a clean host) — see §B.6 above
- Test #11 (external port scan — confirm only Cloudflare's path is reachable)

And check TASK.md's Known Gaps section — several things (attachment purge job, upload MIME-sniffing/re-encoding, signature_assets read-policy narrowing) are deliberately not yet built. Know what you're shipping without, not just what you're shipping with.

---

## Troubleshooting — Symptom → Cause

Cross-referenced against NOTE.md's 2026-08-09 entries, which have the full explanation for each:

| Symptom | Likely cause |
|---|---|
| `auth`/`rest`/`storage` crash-loop with `password authentication failed` | Role passwords never set — run `scripts/bootstrap-db-roles.sh` (§A.4) |
| `db` init fails with `relation "auth.mfa_factors" does not exist` | Migrations got mounted into `docker-entrypoint-initdb.d` and ran before `auth` ever started. Don't do that — apply manually (§A.6) after `auth` is healthy. |
| `auth` fails with `required key API_EXTERNAL_URL missing value` | This one GoTrue config key is read unprefixed (`API_EXTERNAL_URL`, not `GOTRUE_API_EXTERNAL_URL`) — already fixed in the committed `docker-compose.yml`, but re-check if you've edited it |
| Wizard's own domain/tag/level writes 401 with "new row violates row-level security policy" during bootstrap | A read policy on the table doesn't include `is_bootstrapping()` — Postgres requires the SELECT policy to pass for `RETURNING`, not just the write policy's `WITH CHECK` (see `0003_wizard_rls.sql`) |
| Every authenticated request 400s right after a fresh signup | New user's JWT `role` claim is empty — check `GOTRUE_JWT_DEFAULT_GROUP_NAME`/`GOTRUE_JWT_AUD` are set (§ auth service env) |
| Everything works via `curl` but the browser shows "Failed to fetch" | CORS — check the browser console specifically (network tab status codes don't show this), not just network request status. Check `kong.yml`'s `cors` plugin headers list — `supabase-js` sends several non-obvious ones (`X-Supabase-Api-Version`, `Content-Profile`, `Accept-Profile`) that fail one at a time if missing |
| A trigger on `auth.users`/`auth.mfa_factors` fails with `relation "X" does not exist`, but the table clearly exists | The function is `SECURITY DEFINER` and doesn't pin `search_path` — it's inheriting the caller's (`supabase_auth_admin`, pinned to `auth` only) instead of resolving `public` schema tables. Add `set search_path = public` to the function definition. |
| `ALTER ROLE authenticator ...` fails with "is a reserved role, only superusers can modify it" | You're connected as `postgres`, which isn't `SUPERUSER` in this image — connect as `supabase_admin` instead |
| GoTrue mailer fails with "unencrypted connection" | Your SMTP host doesn't support STARTTLS and isn't `localhost` — GoTrue refuses to send over plaintext to anything else. Use real SMTP with TLS, or see §A.7's local-dev workaround. |
