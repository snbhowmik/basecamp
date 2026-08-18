# HANDOFF — Where this project actually stands

**Written:** 2026-08-19
**For:** whoever picks this up next, including a fresh Claude Code session running on the VPS.

> Read this before touching anything. It is deliberately blunt about what is
> proven, what is written but unproven, and what is quietly incompatible.
> ARCH.md is **stale** (it describes the v1 schema through `0003` only) —
> trust the migration files and this document over it.

---

## 1. The one-paragraph version

Basecamp is a self-hosted request/ticketing platform, first configured for
OD approvals at SRM Trichy. **v1 is deployed and working** at
`https://basecamp.hackerxploit.org` — captain account created, invites
sending real email, the rebranded frontend live. **v2 is fully designed and
written but has never touched a database**, and the frontend still targets
the v1 schema. Those two facts are the whole state of the project.

---

## 2. What is running right now

| Thing | State |
|---|---|
| VPS | netcup, Ubuntu, `152.53.18.209`, rebuilt from fresh ISO 2026-08-18 |
| Stack | `docker compose` — db, auth, rest, realtime, storage, garage, meta, studio, kong, frontend, mailer |
| Public entry | Cloudflare Tunnel → Kong on `127.0.0.1:8000`. No inbound ports for the app. |
| Mail | Mailcow **on the same host**, serving `hackerxploit.org` |
| Schema applied | `supabase/migrations/0001`–`0008` (v1) |
| Accounts | one captain (`basecamp@hackerxploit.org`) |
| Frontend | The Countersigned Slip rebrand, SRM palette, live |

**Verified working end to end**, not merely reviewed: setup wizard, TOTP
enrolment, login, invite creation, invite email delivery to both Zoho and
Gmail, and the `/invite/<token>` accept screen.

**Known and accepted:** invite mail lands in spam on first contact. SPF,
DKIM, DMARC and rDNS are all correct and the IP is off every blocklist —
this is an unwarmed domain, not a misconfiguration. Before onboarding at
scale, consider relaying outbound through a service with existing reputation.

---

## 3. The critical fact: v2 is written and unapplied

`supabase/schema-v2/` holds a **complete replacement baseline**, not
migrations onto v1:

```
0001_foundation.sql   identity, org tree, batches/sections, role assignments,
                      tags, levels, authorization helpers
0002_requests.sql     taxonomy, requests, participation, checks, visibility
                      rules, comments, attachments, signatures
0003_rls.sql          every policy, plus the column-level trigger on
                      member_profiles
0004_bootstrap_...    invites, signup gate, people search, lifecycle RPCs,
                      mailer role
```

**It has never been applied to any database.** Validation so far is static
only: declaration order, foreign keys resolving to real columns, and every
helper function called being defined. That process caught four real bugs, so
it was worth doing — but it cannot catch plpgsql body errors, policy
recursion, or how `auth.uid()` behaves under PostgREST.

**First job for the next session: apply it to a throwaway database and fix
what breaks.** Do not apply it to the live instance until it runs clean
somewhere disposable.

### Applying it

The intended path is a full reset — there is one account and no real data,
so nothing is lost:

```bash
docker compose down -v          # destroys the volume, and therefore the captain
docker compose up -d db
./scripts/bootstrap-db-roles.sh
docker compose up -d auth       # MUST be healthy before migrations
# point apply-migrations.sh at schema-v2/, or apply the four files in order
./scripts/bootstrap-db-roles.sh # again — the mailer role only exists after 0004
docker compose up -d
```

`scripts/apply-migrations.sh` currently reads `supabase/migrations/`. Either
repoint it or swap the directories. It tracks applied files in
`basecamp_meta.schema_migrations`, so re-running is safe and only new files
apply.

---

## 4. The incompatibility nobody has dealt with yet

**The frontend targets the v1 schema.** Applying schema-v2 breaks it. This
is expected and planned, not an oversight — but it is real work and nobody
has started it.

What changed underneath `app/src/lib/`:

| v1 | v2 |
|---|---|
| `student_profiles` | `member_profiles` (students **and** staff, `member_type`) |
| `user_levels` (one level per user) | `role_assignments` (several, scoped, time-boxed) |
| `departments` + `classes` | `org_units` (faculty→programme) + `batches` + `sections` |
| `my_rank()` | `my_best_rank()` / `my_rank_in(org_unit)` |
| `is_base_level()` | `is_lowest_level()` |
| `create_department` / `create_batch` | org-unit RPCs (not yet written) |
| `list_public_departments` | `list_public_org_units` |
| `search_forward_targets` (name/email) | `search_people` (reg-no first) |

New surfaces v2 implies that have **no UI at all yet**: the "acting as"
context switcher (PRD-V2 D-1), person cards (§9), CGPA submission and
verification (§9.3), level-check ticking (§5), and org-tree admin (§3.2).

---

## 5. Conventions that are not negotiable

**Commit as the git default author.** Do not add `Co-Authored-By` trailers
or otherwise attribute commits. Stated directly by the user 2026-08-18.

**No fixture data, ever.** A real deployment gets exactly one account from
the wizard — the captain. Every level, tag, org unit, and account after that
is created by hand by a human at the right level. `supabase/seed.sql` is
demo-only and must never run on a real instance.

**RLS is the authorization boundary.** Never a frontend check. Every
relationship check is written once as a `security definer` function and
reused — never inlined into a policy. Every such function pins
`set search_path = public`; v1 left eight unpinned and that is exactly how a
trigger silently resolves the wrong tables.

**Verify against a running stack.** This project has repeatedly found bugs
that only appear when actually run — the migration ordering blocker, the
role passwords, the CORS headers, the blank-page env var. "It typechecks" is
not "it works."

---

## 6. Traps that have already cost time

Each of these has bitten at least once. All are documented in DEPLOY.md.

- **Migrations before `auth` is up** → `relation "auth.mfa_factors" does not
  exist`. GoTrue creates that table on first connect. The file rolls back
  whole (`psql -1`) so retrying is safe.
- **`bootstrap-db-roles.sh` runs twice**, and the two runs do different
  things. First: Supabase role passwords, before `auth` can connect at all.
  Second: the mailer password, for a role that does not exist until the
  invite migration.
- **`docker compose up -d` before the first frontend build** → Docker creates
  `app/dist` as root, and the next `npm run build` dies with `EACCES` wearing
  a Vite stack trace. Build first.
- **Missing `app/.env.local`** → blank white page, no error. It is gitignored,
  Vite inlines `VITE_*` at build time, and `supabase.ts` throws before React
  mounts. Restarting the container cannot fix it; only rebuilding can.
- **Kong routes `/` to the frontend as a catch-all.** `nginx/frontend.conf`
  supplies the SPA fallback so `/invite/<token>` resolves on a cold load.

---

## 7. Open questions, still unanswered

From PRD-V2, and they gate real work:

- **§8.3** — is the register-number serial always 3 digits, and does it
  restart per batch? Do lateral-entry students follow the same format? This
  gates whether signup validation can hard-reject or must warn-and-allow.
- **§11.1** — is the FET ID format fixed and validatable like a register
  number, or free-form? Determines whether it gets a prefix check or only
  uniqueness.
- **§9.3** — do CGPA collection windows apply per programme, per batch, or
  institute-wide? `cgpa_windows.org_unit_id` currently allows any of the
  three, which may be more flexibility than the real process needs.

---

## 8. Suggested order from here

1. **Apply `schema-v2` to a throwaway database.** Fix what breaks. This is
   the only step that turns 2,000 lines of unproven SQL into something
   trustworthy.
2. **Repoint `apply-migrations.sh`** at the new directory, and retire
   `supabase/migrations/` once v2 is proven.
3. **Migrate `app/src/lib/`** to the v2 names and RPCs — this is where the
   breakage lands, and it is mechanical but wide.
4. **Re-run the wizard** on the clean database and rebuild the org.
5. **Then** the new v2 surfaces: context switcher, person cards, checks,
   org-tree admin.

Do not start 5 before 1. The whole point of applying early is that a schema
bug found now costs an afternoon, and the same bug found after the frontend
is rewritten against it costs the rewrite.

---

## 9. Where to read what

| Document | What it is | Trust |
|---|---|---|
| `PRD.md` | v1 product definition | Current |
| `PRD-V2.md` | v2 design, decisions D-1..D-6, open questions | Current, iterating |
| `ARCH.md` | v1 schema, **only through `0003`** | **Stale** — code wins |
| `NOTE.md` | dated decision and incident log, with reasoning | Current, authoritative on "why" |
| `TASK.md` | build tracker, known gaps | Current |
| `SECURITY.md` | threat model, risk register R-01..R-32 | Current |
| `DEPLOY.md` | deployment runbook, Part C covers host rebuild | Current, battle-tested |
| `DESIGN.md` | the frontend's visual system | Current |
