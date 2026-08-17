# NOTE — Decisions, Hurdles & Gotchas
**Basecamp v1.0.0**
**Last Updated:** 2026-08-11

> Earlier notes about Keycloak, the custom authorization engine, and the Cloudflare Worker BFF are retired — none of that exists anymore. What's below is current.

---

## 🔴 BLOCKERS

---

### [2026-08-09] [BLOCKER] [INFRA]
**Migrations cannot be auto-mounted into `docker-entrypoint-initdb.d` — they depend on tables GoTrue creates itself**

`0001_schema.sql` creates a trigger on `auth.mfa_factors`. That table doesn't exist until the `auth` (GoTrue) container has started at least once and run its own internal migrations — it isn't part of the base `supabase/postgres` image. Mounting our SQL into Postgres's own init sequence runs it before any other container has started, so that `CREATE TRIGGER` fails — and because the init entrypoint runs each file with `ON_ERROR_STOP=1`, that single failure aborts the *rest* of Postgres's own init sequence too, including the scripts that set passwords on `authenticator`/`supabase_auth_admin`/`supabase_storage_admin`. One missing table cascaded into every other service failing to authenticate.

**Resolution:** Don't mount `supabase/migrations/` into the db container at all. Bring up `db`, then `auth`, wait for both healthy, then apply migrations manually and in order. See `scripts/apply-migrations.sh` and DEPLOY.md.

---

### [2026-08-09] [BLOCKER] [INFRA]
**`authenticator`/`supabase_auth_admin`/`supabase_storage_admin` never get a password from `POSTGRES_PASSWORD`**

The base `supabase/postgres` image's own init scripts create these roles but leave them with no password at all — `docker-compose.yml`'s connection strings assume they share `POSTGRES_PASSWORD`, but nothing actually sets it. Every one of `auth`, `rest`, `storage` fails SASL auth against a totally fresh instance.

**Resolution:** One-time `ALTER ROLE ... WITH PASSWORD` step, run as `supabase_admin` (not `postgres` — see next entry) immediately after `db` reports healthy. `scripts/bootstrap-db-roles.sh`.

---

### [2026-08-09] [BLOCKER] [INFRA]
**`postgres` is not `SUPERUSER` in this image — `supabase_admin` is**

Confirms and resolves the open question in SECURITY.md R-02/§7#1. This image deliberately strips `SUPERUSER` from `postgres` and makes `supabase_admin` the real superuser instead — a sane default, not a bug. But it means `ALTER ROLE` on the reserved `authenticator`/`supabase_auth_admin`/`supabase_storage_admin` roles, and applying migrations that need elevated privileges, must connect as `supabase_admin`. Connecting as `postgres` gets "is a reserved role, only superusers can modify it" even though `postgres` looks like it should be able to.

**Resolution:** All admin-ish scripts (`scripts/bootstrap-db-roles.sh`, `scripts/apply-migrations.sh`) connect as `supabase_admin -d postgres`, not `postgres`.

---

### [2026-08-09] [BLOCKER] [RLS]
**A table's SELECT policy gates `RETURNING`, not just its own INSERT/UPDATE's `WITH CHECK`**

Postgres requires a row to pass a table's SELECT policy for it to be returned by `INSERT ... RETURNING` / `UPDATE ... RETURNING` — on top of that statement's own `WITH CHECK`. `supabase-js`'s `.insert()`/`.upsert()` default to `Prefer: return=representation` (wants the row back), so an admin-only read policy on `allowed_login_domains` was silently blocking the wizard's own bootstrap-phase domain insert, even though the INSERT itself was permitted. The error Postgres raises for this ("new row violates row-level security policy") is identical to a genuine `WITH CHECK` failure — nothing distinguishes the two cases in the error message.

**Resolution:** `allowed_login_domains_read` (`0003_wizard_rls.sql`) includes `is_bootstrapping()` in its `USING` clause, matching the write policy. General lesson: any bootstrap-phase write policy needs a matching bootstrap-phase read policy if the caller ever requests the row back.

---

### [2026-08-09] [BLOCKER] [AUTH]
**New users get an empty JWT `role` claim without `GOTRUE_JWT_DEFAULT_GROUP_NAME` + `GOTRUE_JWT_AUD`**

Without these, `auth.users.role` and the issued JWT's `role`/`aud` claims come back as `""` instead of `"authenticated"`. PostgREST then tries `SET ROLE ""` for every request from that session and every single one 400s — including reads of the caller's own data. Deprecation-warned in GoTrue's own startup logs ("not supported... will be removed soon") but still required to actually work in v2.150.0.

**Resolution:** Both set in `docker-compose.yml`'s `auth` service. Verified live: without them, a fresh signup's `user.role` is `""`; with them, `"authenticated"`.

---

### [2026-08-09] [BLOCKER] [INFRA]
**No CORS plugin in Kong — invisible to `curl`, blocks every browser request**

`curl`/server-to-server calls don't enforce CORS, so the entire signup→MFA→wizard flow tested fine via `curl` while failing completely in an actual browser with "Failed to fetch" — a genuinely confusing failure mode with no useful client-side error until you check the browser console specifically (`read_console_messages`, not network status codes, showed the real CORS rejection reason).

**Resolution:** `cors` plugin in `kong.yml`, headers list includes `X-Supabase-Api-Version`, `Content-Profile`, `Accept-Profile` — non-obvious headers `supabase-js` sends that a minimal CORS allowlist misses one at a time (each missing header produces one more failed round-trip). `origins: "*"` for now since the frontend's real origin isn't fixed yet; tighten before production.

---

### [2026-03-01] [BLOCKER] [RLS]
**The helper-function pattern is not optional — it's what makes this maintainable at all**

Flagged earlier in conversation: relationship checks like "is this person the HOD of this department" must be written once, as a `SECURITY DEFINER` function, and called everywhere — never inlined per-policy. If the definition of "HOD of a department" changes and it's inlined in ten places, nine correct updates and one missed one is how a real leak happens.

**Resolution:** `is_hod_of()`, `is_mentor_of()`, `has_dashboard_access()`, `has_mfa()`, `has_tag()`, `my_rank()` are the canonical set. Every policy calls these. Adding a new relationship check means adding a new function first, not writing a new join inline.

---

### [2026-03-01] [BLOCKER] [RLS]
**Verify which Postgres role actually runs queries at runtime, and that it isn't superuser**

Self-hosted Supabase's own docker-compose sets this up sensibly by default, but "by default" needs to be checked, not assumed, for this specific deployment. If the role PostgREST connects as turns out to be a superuser or has `BYPASSRLS`, every policy in the schema is decorative.

**Resolution:** Before writing a single policy, confirm the runtime role's attributes (`\du` in `psql`, check `rolsuper` and `rolbypassrls`). Apply `FORCE ROW LEVEL SECURITY` on every table regardless, as a backstop.

---

## 🟡 WARNINGS

---

### [2026-08-09] [WARN] [SCHEMA]
**`SECURITY DEFINER` trigger functions on `auth.*` tables must pin `search_path` explicitly**

`handle_new_user()`, `sync_mfa_enrolled()`, and `check_allowed_domain()` all fire in a transaction run by `supabase_auth_admin` (the role GoTrue connects as), whose `search_path` is pinned to `auth` only by the base image — a deliberate security boundary, not an oversight on Supabase's part. Our functions referenced `public` schema tables (`profiles`, `allowed_login_domains`) unqualified, which resolved fine when tested by hand as `supabase_admin` (whose `search_path` does include `public`) but failed with "relation does not exist" the moment they fired for real from GoTrue's session. Tested manually as the wrong role, twice, before catching this — a reminder that testing a `SECURITY DEFINER` function's *logic* by calling it directly as an admin role doesn't prove it works when actually triggered from the caller context it's designed for.

**Resolution:** All three now declare `security definer set search_path = public`. General rule going forward: any `SECURITY DEFINER` function that might fire from a non-`public`-search-path role (anything on `auth.*`) must pin its own `search_path`, not inherit the caller's.

---

### [2026-08-09] [DECIDED] [AUTH]
**Local dev testing without production SMTP: flip `GOTRUE_MAILER_AUTOCONFIRM` temporarily, don't fight TLS-less mail catchers**

Production uses real SMTP (self-hosted Mailcow on the org's own domain — confirmed workable: it's a standard Postfix/Dovecot stack, exposes normal SMTP submission on 587 with STARTTLS, exactly what `GOTRUE_SMTP_*` expects, contingent on SPF/DKIM/DMARC being set up correctly on the domain). GoTrue's mailer refuses to send over an unencrypted connection to anything except a host that resolves as `localhost` — Mailhog (the throwaway local catcher used to verify the wizard end-to-end) doesn't speak TLS at all, so even sharing its network namespace with `auth` to get a `localhost` hostname didn't reliably work. Chasing a TLS-capable local mail catcher further wasn't worth the time against the actual goal (proving the app/schema/RLS work, not proving a disposable local mail catcher can be made to negotiate TLS).

**Resolution:** For local-only verification, temporarily flip `GOTRUE_MAILER_AUTOCONFIRM` to `"true"` in `docker-compose.yml`, test, then revert to `"false"` before committing — real SMTP is required for a real deployment, autoconfirm-true is a local-dev convenience only, never checked in as `"true"`.

---

### [2026-03-01] [DECIDED] [AUTH]
**Domain allowlist enforced by a trigger directly on `auth.users`, not client-side**

Was an open warning; now resolved. `check_allowed_domain()` fires on `auth.users` insert, before a profile even exists — rejects signup at the lowest possible layer. Someone calling the GoTrue signup API directly, bypassing the frontend form entirely, still gets refused if their email domain isn't in `allowed_login_domains`.

---

### [2026-03-01] [WARN] [SCHEMA]
**`decision_mode` is copied onto `requests` at creation, not looked up live from the category**

If a category's `decision_mode` changes after requests already exist under it, those existing requests must not suddenly flip from "needs approval" to "just log it" or vice versa mid-flight. Copying the value at creation time and treating it as immutable on the request avoids that entirely — same principle as the workflow-versioning problem from the previous architecture, solved more simply here because there's no multi-step graph to version.

---

### [2026-03-01] [WARN] [MODEL]
**Achievements are just `requests` now — don't accidentally rebuild a parallel certificate system**

Earlier versions had a dedicated `certificates` table with its own points/scoring logic. That's now explicitly the same thing as a log-only request under the Achievement Log category. If a "certificate points" feature is built later, it should hang off `requests`/`request_categories` (e.g. a `points_value` column on the category, snapshotted onto the request at review time) — not a second parallel table that then needs its own RLS, its own history, its own everything.

---

### [2026-03-01] [WARN] [STORAGE]
**No per-user upload quota specified yet**

The re-encoding pipeline reduces the footprint of any single file, but nothing currently stops one account from uploading relentlessly. At 8,000+ users this needs an actual number, not just "some limit eventually."

**Resolution:** Open question — needs a concrete quota (e.g. per-user daily upload count, or total storage per student) before launch. Logged in SECURITY.md R-16.

---

### [2026-03-01] [WARN] [MODEL]
**Search-and-forward has no guardrail — this is a deliberate choice, not an oversight**

Any staff member can forward a request to any other person in the system, with no allowlist restricting who can receive what. This was chosen deliberately over building a permission matrix for forwarding, because the actual organisational need described was "search and forward to anyone" — restricting it would contradict the stated requirement. The safety net is that every forward is logged in `request_assignment_history`, so misuse is visible after the fact even though it isn't prevented upfront. Worth revisiting only if this turns out to be actually abused in practice.

---

### [2026-03-01] [WARN] [FILES]
**Cloudflare R2 API tokens should be scoped to a single bucket, not account-wide**

R2 supports creating API tokens limited to specific buckets. Using an account-wide token means a leak of that credential exposes far more than the portal's own files.

**Resolution:** Create a bucket-scoped token specifically for `srm-portal-files`. Document the token's exact permissions in the deployment runbook.

---

## 🟢 DECISIONS

---

### [2026-08-18] [DECIDED] [INFRA]
**Invite emails are sent by a background worker — this is not the BFF that was rejected in 2026-08-10**

Invites produced a `/invite/<token>` link that the inviter had to copy and send by hand. Automating that delivery needs a process that can talk SMTP, and the browser cannot.

The 2026-08-10 entry below rejected a server-side component, so it's worth being precise about why this one is allowed rather than quietly contradicting it. That decision was about **creating accounts**, which requires `service_role` — a key that bypasses RLS entirely and would hand whatever holds it the ability to read and write every row in the database. The objection was to the key, not to the existence of a process.

Sending a notification email needs none of that. `services/mailer` connects as `basecamp_mailer`, a role created `NOLOGIN` by `0008_invite_email.sql` with **no table privileges at all** and exactly three function grants. It cannot create a user, cannot read a request, cannot bypass RLS, holds no `service_role` key, and listens on no port — Kong has no route to it. It reads a queue and sends mail.

It is also not a BFF in the sense ARCH.md §2 rules out: nothing in a client's request path passes through it. The frontend still talks to PostgREST directly. If the mailer is down, invites still work — the link still resolves, it just isn't emailed. That's the test that matters: a BFF is load-bearing for reads and writes, and this isn't.

**Worst case if the container is compromised:** disclosure of pending invite tokens, which would let an attacker claim an invited role before its intended holder. Bounded and serious, but not account creation and not data access. Logged in SECURITY.md.

**Delivery model:** claim-then-send, not send-then-mark. `claim_invite_emails()` stamps `invite_email_claimed_at` and increments an attempt counter inside the same statement that selects the rows (`FOR UPDATE SKIP LOCKED`), so a worker that dies mid-send doesn't leave a row that re-sends on every subsequent poll. A claim older than 5 minutes is treated as abandoned and retried; 5 failed attempts stops retrying and surfaces "send the link manually" in the UI. The copyable link never went away — it's the fallback, and the reason a mail outage isn't an onboarding outage.

---

### [2026-03-01] [DECIDED] [FOUNDATION]
**Self-hosted Supabase, not managed Supabase, not custom Keycloak+Node**

Managed Supabase would have been faster but isn't self-hosted. Custom Keycloak+Node gives maximum control but means building and proving correct an authorization system from scratch, which is the single highest-risk piece of software to get subtly wrong — and there's no clear long-term maintainer to inherit that complexity. Self-hosted Supabase is self-hosted, restores `auth.uid()`-based RLS as a real enforcement boundary, and ships MFA natively. Chosen specifically because it's the smallest system that still satisfies "actually self-hosted."

---

### [2026-03-01] [DECIDED] [RBAC]
**Priority levels (ordered rank) + tags (free-form identity), not a fixed role enum**

Confirmed directly: two people at the same level can hold entirely different jobs (two Level-2 people, one HOD-CS, one HOD-ECE), and levels themselves are meant to be insertable, not fixed. A role enum baked into the schema can't express that without a migration every time an org's structure differs even slightly. Rank + tags is the general version.

---

### [2026-03-01] [DECIDED] [ROUTING]
**Picker + search-and-forward, not a visual workflow graph, for v1**

Confirmed: each approval-mode category gets a configurable suggested-recipient picker; after the first hop, anyone can forward to anyone via search, logged. A Node-RED-style visual graph builder was the original inspiration but is explicitly deferred — the picker model covers every routing need described so far (Tech→Mentor-or-other, Non-Tech→Coordinator, both→Mentor+HOD watchers regardless) without the build cost of a graph engine.

---

### [2026-03-01] [DECIDED] [SCOPE]
**Single org, multiple login domains — not multi-tenant**

Confirmed: this is SRM Trichy, accepting several valid institutional email domains, not several separate organisations sharing one deployment. `allowed_login_domains` is a flat allowlist, not a tenant-partitioning mechanism. If true multi-org is ever needed, that's a materially different data model (tenant_id on every table) and a future decision, not something to half-build now.

---

### [2026-03-01] [DECIDED] [MODEL]
**Two decision modes on one request model, not two separate systems**

Confirmed directly: the "just log it, nothing to approve" record type described (online events, achievements) is the same underlying thing as an OD request — a request with a category — just with `decision_mode = log_only` instead of `approval`. Building this as one table with a mode flag, rather than a parallel `certificates` table, roughly halves the schema and RLS surface area that needs to be kept correct.

---

### [2026-03-01] [DECIDED] [ANALYTICS]
**Dashboard access is its own grant, scoped per-department, admin-controlled — not derived from level or tags**

Confirmed: a Dean's dashboard access covers whichever departments Admin has specifically granted, which may be several, and this permission is independent of approval authority — someone could have dashboard access with no approval role at all, or vice versa. `dashboard_grants` is a standalone table for exactly this reason; deriving dashboard visibility from level or tags would conflate two things that are meant to be independently controllable.

---

### [2026-03-01] [DECIDED] [SCALE]
**8,000+ students is the real target, not a stress-test hypothetical**

Confirmed directly. This means: external object storage (R2) is foundational from day one, not an optimization to add later; the upload pipeline's compression step is load-bearing, not a nice-to-have; and any future schema decision should be checked against "does this still work reasonably at 8,000 rows × however many requests per student per year" rather than assumed fine at small scale.

---

---

### [2026-03-01] [DECIDED] [MODEL]
**Parent Undertaking stopped being a document entirely**

Corrected mid-build: since the whole application is digital, there's no scan/upload step for parent consent at all. The Mentor calls the parent, confirms verbally, and records it — `parent_consent_verified`, who verified it, when, plus the parent's name, contact, and transport mode — directly on `request_participants`. No file, no "preserve byte-for-byte" exception, no forgery-of-a-scanned-document risk. This removed an entire category of storage and an entire category of risk (the old R-17) from the project in one correction.

---

### [2026-03-01] [DECIDED] [MODEL]
**Signatures are a stored per-person asset, not a per-document action**

A staff member registers their signature once — canvas-drawn or uploaded-and-cleaned — and it's reused on every generated document that needs it from then on, the same way a physical signature works once someone has one. `signature_assets` holds exactly one active stamp per person (enforced by a unique partial index).

---

### [2026-03-01] [DECIDED] [MODEL]
**Generated documents (Annexure 4.4, NOC) are cache, not source of truth**

The PDF a student downloads can be recreated identically at any time from the request data, the stored signature assets, and the template — so it doesn't need to be protected as an irreplaceable file. What's protected is the `generated_documents` row: a `reference_code`, a `state_hash` of the exact data that was signed, and which signatures were stamped in. This is also what makes the document verifiable — look up the code, compare the hash, confirm it's real — independent of whether that specific PDF still exists anywhere. NOC works identically to Annexure 4.4: same pattern, different template, generated the moment the student clicks download.

---

### [2026-03-01] [DECIDED] [STORAGE]
**Attachments are purged after ticket close — certificates are the only permanent files**

OD evidence attachments (posters, letters, receipts, tickets) only matter while a request is active. Once the HOD closes the ticket following event review, they're purged automatically after a 7-day grace period. This is a per-category setting (`retain_attachments_after_close`), not hardcoded — Achievement/certificate categories default to permanent retention, OD categories default to purge-on-close. This single change narrowed "what needs real backup discipline" down to essentially one thing: certificates.

**Known gap, not silently shipped:** the trigger that marks attachments for purge (`schedule_attachment_purge()`) exists and works. The job that actually deletes the object from Garage and removes the row once `purge_after` has passed does **not** exist yet. Flagged in SECURITY.md R-24 and TASK.md — a `purge_after` column nothing reads is a data-minimization promise not being kept.

---

### [2026-03-01] [DECIDED] [STORAGE]
**Reversed course: Garage self-hosted as primary, not Cloudflare R2**

Earlier in this project, R2 was chosen as primary file storage specifically to avoid a VPS disk filling up. Reconsidered directly: R2 is still a third-party dependency, which cuts against the actual point of self-hosting. Landed on self-hosted Garage on a separately attached, independently growable block volume — genuinely self-hosted, no external API dependency for the thing users touch constantly (viewing/uploading certificates).

**The tradeoff, stated plainly:** a managed service like R2 replicates data automatically; a single-node self-hosted Garage instance does not (`replication_mode = "none"`). A disk failure on that volume loses every certificate. This is why the offsite encrypted backup to R2/B2 isn't optional polish anymore — it's the only thing standing between a hardware failure and permanent loss of every student's certificates. The restore drill (SECURITY.md, TASK.md) matters more now than it did when R2 was primary, not less.

---

### [2026-03-01] [WARN] [RLS]
**`signature_assets_read_staff` policy is broader than it should be — flagged at build time, not discovered later**

As written, any non-student can read any other user's stored signature image directly from the table — a mentor could fetch the Dean's signature PNG. This was written to let document generation stamp the right signature in, but it grants that access to every staff member browsing the table, not just the generation process itself. Needs narrowing to a `security definer` function or Edge Function that document generation calls, rather than a blanket read policy. Logged as SECURITY.md R-26 — this is a known, called-out gap in the shipped code, not something to discover during a later audit.

---

### [2026-03-01] [WARN] [RLS]
**`is_base_level()` assumes the highest `rank` value always means "student" — this breaks if the hierarchy shape changes**

Every policy distinguishing student from staff calls `is_base_level()`, which compares the caller's rank to `max(rank)` in `priority_levels`. This holds for the seeded 5-level structure. If an org later inserts a level below Student — or restructures ranks in a way that changes what "highest number" means — every policy relying on this function silently reinterprets who counts as a student. Needs a test that fails loudly on that condition rather than assuming the shape never changes. Logged as SECURITY.md R-27.

---

### [2026-08-11] [BLOCKER] [RLS]
**RLS denial returns an empty set, not an error — the public registration form's dropdowns were blank for exactly that reason**

`0003_wizard_rls.sql` gates `departments`/`classes` reads behind `auth.uid() is not null`, which was correct when the only readers were signed-in users filling in an invite form. `0005` then added public student self-registration, where the registrant picks their department and batch *before* having an account. That page's queries were filtered to zero rows — no error, no failed request, no console warning. The dropdowns simply rendered empty and looked like the captain hadn't created any departments yet.

**Resolution:** `list_public_departments()` / `list_public_batches()` in `0007_public_catalog.sql`, SECURITY DEFINER, granted to `anon`. Deliberately *not* opening the tables themselves to `anon`: the RPCs return `(id, name)` only, keeping `tag_id` invisible — that's the handle `is_hod_of()`/`is_mentor_of()` resolve scope through, and unauthenticated visitors have no business seeing the permission system's wiring. The names themselves aren't secret; minimal exposure is the point.

**The pattern, now three for three:** every bug that has reached a real user in this project came from testing the authenticated/happy path and not the other one — the `/verify` link nobody clicked from a fresh tab, the CORS headers `curl` doesn't enforce, and now the anonymous read that returns `[]` instead of `403`. **When adding any pre-auth surface, exercise it signed out, in a real browser, before calling it done.** Also worth the habit: render "nothing configured yet" explicitly instead of an empty control, so the failure at least announces itself (done in `RegisterForm`).

---

### [2026-08-11] [BLOCKER] [RLS]
**`request_field_values` shipped with no row security at all — found only while building the feature that uses it**

0002 enabled RLS on "every user-data table" and 0003 covered the catalog tables, but `request_field_values` fell between the two lists and nobody noticed, because nothing had queried it yet. PostgREST exposes everything in `public`, so for five migrations any authenticated user could read and write every custom field value on every request in the system.

**Resolution:** RLS enabled + forced in `0006_requests_and_org.sql`, reads gated by the new `can_see_request()` helper, writes limited to the request's owner. Logged as SECURITY.md R-28.

**The actual lesson, which matters more than the fix:** "RLS is enabled on every user-data table" was being maintained as a hand-written list across two migrations. That is not a control, it is a hope. Added as pre-production test #12: enumerate `pg_tables` where `schemaname = 'public'` and assert `rowsecurity` on every row. A table with no policy is a table with no protection, and the failure is silent — nothing errors, the data is just readable.

---

### [2026-08-11] [DECIDED] [MODEL]
**Request lifecycle transitions are RPCs, not client-side multi-step writes**

Submitting, deciding, and forwarding each touch several tables at once — the request row, `request_assignment_history`, and (for an approval-mode decision) `signatures`. Doing that from the client means three separate PostgREST calls that can half-apply, leaving a request that's approved with no signature or forwarded with no audit trail.

They're `SECURITY DEFINER` functions instead (`create_and_submit_request`, `decide_request`, `forward_request`), each re-checking authorization internally — holder identity and `has_mfa()` — because SECURITY DEFINER bypasses the RLS that would otherwise enforce it. `requested_by` is always `auth.uid()` and never a parameter, for the same reason: accepting it from the caller would let anyone file a request as anyone else.

The signature's `state_hash` is computed server-side from the row as actually stored, never supplied by the client — a client-supplied hash proves nothing about what was signed.

---

### [2026-08-10] [DECIDED] [MODEL]
**Cascading account creation is invite-by-email, not admin-set-password — the architecture has no backend to do the latter safely**

Confirmed directly: "Dean creates HOD, HOD creates Mentor/Student" needed a real mechanism, and the obvious one — an admin directly creating another user's account via `supabase.auth.admin.createUser()` — requires the `service_role` key, which must never reach the frontend (SECURITY.md R-12, a critical-risk item, not a style preference). This architecture deliberately has no BFF/custom backend to hold that key server-side either (ARCH.md §2: "No Worker, no BFF").

Landed on pre-provisioned invites instead (`0004_account_provisioning.sql`): an authorized person declares "this email becomes an HOD of dept X" as a `pending_assignments` row — no auth user, no password, nothing GoTrue-visible. The invitee later signs up through the exact same self-service flow the captain used (email+password+MFA), and a trigger on `profiles` insert matches their email and grants the declared level/tags automatically. Fully server-side via `SECURITY DEFINER`, no client ever touches an elevated key, no bootstrap-style RLS window needed the way the wizard needed one.

Who can invite whom is rank-based (`can_invite()`: inviter must outrank the target level, and if department-scoped, must hold that department's tag) rather than hardcoded to "Dean" or "HOD" by name — consistent with priority levels not being fixed roles (PRD §6.1).

**Side effect, deliberate:** signup is no longer open-to-anyone-on-the-domain once the captain exists. `check_allowed_domain()` now also requires a live, unconsumed invite. Previously anyone on an allowed domain could self-register with zero level/tags — that gap is closed as part of this change, not left as a known issue.

---

### [2026-08-09] [DECIDED] [MODEL]
**No fixture data, ever — the wizard creates exactly one account, everything else is built by hand**

Confirmed directly: the wizard creates the **captain** (labeled "Captain" in the UI; the underlying tag *code* stays `admin` since `has_tag('admin')` is load-bearing throughout `0002_functions_and_rls.sql` — renaming the code would mean touching every policy in that file for a cosmetic change). Every other account is created by hand, inside the app, by someone who already holds the right level — never seeded, never scripted. `supabase/seed.sql` is retitled as demo/reference-only for exactly this reason; a real deployment must not run it. This is deliberate, not a shortcut: verification happens by hand every time, not by trusting fixture data — matches how the real org actually works, described directly:

- A **Dean** is scoped to one institute (e.g. IST and TRP each have their own Dean — different people, different accounts) and may hold several emails. A department can also have its own Dean. Deans create HOD accounts for their department.
- An **HOD** creates Mentor and Student accounts, and Student Outreach Faculty accounts (a distinct staff tag, not a HOD/Mentor variant), for their department.
- Only the captain configures priority levels themselves and hands out the `admin` tag — but the captain *can* create an account at any level directly if needed; in practice they mostly seed the top of each chain and let it cascade.

**Not yet built:** the cascading create-account-at-my-level-or-below UI (Dean creates HOD, HOD creates Mentor/Student/Outreach Faculty). The wizard only gets the captain account and structural minimum onto the board — see TASK.md.

---

### [2026-03-01] [DECIDED] [NAMING]
**Product named Basecamp, v1.0.0**

Noted once, for the record: this collides with 37signals' existing commercial product of the same name. Not an issue for internal departmental use; worth a rename before any public distribution or open-sourcing.

---

## 📋 Open Questions

| # | Question | Priority |
|---|---|---|
| ~~1~~ | ~~Domain allowlist enforcement mechanism~~ — **Resolved**, `check_allowed_domain()` trigger. | — |
| 2 | Per-user / per-student upload quota — concrete number needed | 🟠 Medium |
| 3 | VPS provider, region, specs — now more urgent, determines where the attached growable volume for Garage comes from | 🔴 High |
| 4 | Backup destination and who holds the encryption key — more urgent now that Garage (not R2) holds the only live copy of every certificate | 🔴 High |
| 5 | Should there be a periodic report flagging log-only requests that look like they should have needed approval? | 🟡 Low |
| 6 | When is Dean *approval* (not dashboard access) actually required, if ever, versus dashboard-only? | 🟠 Medium |
| 7 | Canvas library choice — tldraw vs Excalidraw, embedding their document JSON into `canvas_revisions` | 🟡 Low |
| 8 | Notification delivery — still stubbed; when does this get built? | 🟡 Low |
| 9 | The attachment purge job (delete from Garage once `purge_after` passes) — where does this run? A scheduled Edge Function, or a cron job on the VPS itself? | 🟠 Medium |
| 10 | The `signature_assets` read policy needs narrowing (NOTE above) — build this before any real staff signatures are registered, not after | 🟠 Medium |
| 11 | Public verification page for `generated_documents.reference_code` — needed for the "verifiable" property to mean anything to someone outside the system checking a document | 🟡 Low |
| 12 | Upload MIME-sniffing / re-encoding pipeline is designed but not implemented — when does this get built, given certificates are now the only thing that matters for storage? | 🔴 High |
