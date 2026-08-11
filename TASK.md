# TASK — Build Tracker
**Basecamp v1.0.0**
**Last Updated:** 2026-08-10

> This tracks the actual repository, not a theoretical plan. "Done" means it's in `supabase/migrations/`, `docker-compose.yml`, or another real file — not that it's been designed in a doc somewhere.

**Legend:** `[x]` done · `[ ]` not started · `[!]` known gap, flagged deliberately

---

## Done — In the Repository Right Now

### Infrastructure
- [x] `docker-compose.yml` — full stack: kong, auth, rest, realtime, storage, db, studio, garage
- [x] Only `kong` publishes a port, bound to `127.0.0.1:8000`
- [x] `garage/garage.toml` — single-node config, ready to point at an attached volume
- [x] `.env.example` — all required secrets documented with generation notes

### Schema (`0001_schema.sql`)
- [x] Identity: `profiles`, auto-creation trigger on `auth.users`, `mfa_enrolled` sync trigger
- [x] Hierarchy: `priority_levels`, `tags`, `user_tags`, `user_levels`
- [x] Org structure: `departments`, `classes`, `student_profiles`, `allowed_login_domains`
- [x] Taxonomy: `request_types`, `request_categories` (tree), `category_first_hop_options`, `field_definitions`, `request_field_values`
- [x] Requests: `requests`, `request_assignment_history`, `request_watchers`
- [x] Comments/canvas: `request_comments`, `canvases`, `canvas_revisions`
- [x] Signatures: `signatures` (append-only), `signature_assets`, `generated_documents`
- [x] Outstation: `request_participants` with parent consent as structured fields (no file)
- [x] Attachments: `request_attachments` with `purge_after` column
- [x] `dashboard_grants`
- [x] `student_activity_summary` view

### Cascading Account Provisioning (`0004_account_provisioning.sql`)
- [x] `pending_assignments` — an invite: level/tags/department/class declared for an email, nothing auth-visible until they actually sign up
- [x] `can_invite(level, department)` — rank comparison + department-tag membership, not hardcoded role names; admin always allowed
- [x] `apply_pending_assignment()` trigger on `profiles` insert — grants the declared level/tags, creates `student_profiles` for student-shaped invites, marks the invite consumed
- [x] `check_allowed_domain()` extended — signup now requires a live invite once bootstrapping is over, not just an allowed domain (closed the "anyone on the domain can self-register with zero role" gap)
- [x] `hod`/`mentor`/`dean`/`student_outreach` tags ensured to exist (idempotent) — `hod`/`mentor` are structural, referenced by exact code in `is_hod_of()`/`is_mentor_of()`
- [x] `app/src/components/admin/InvitePanel.tsx` — invite form + sent-invites list, wired into the dashboard shell
- [!] Not yet live-tested against a running instance the way the wizard was (see TASK.md's own convention — flag, don't pretend). Verify the full loop (Dean invited → signs up → gets HOD tag automatically) before trusting it with a real department.
- [ ] Resend / edit-in-place for a pending invite (currently: revoke and recreate)
- [ ] Role-aware dashboard nav — right now every signed-in user sees the same invite panel regardless of whether `can_invite()` would ever let them invite anyone

### Wizard Config Table RLS (`0003_wizard_rls.sql`)
- [x] `is_bootstrapping()` — the bootstrap predicate: true until anyone holds the `admin` tag
- [x] RLS enabled + forced on `priority_levels`, `tags`, `departments`, `classes`, `allowed_login_domains`, `request_types`, `request_categories`, `category_first_hop_options`, `field_definitions` — these had none in 0001/0002, a real gap closed after the wizard was built and tested
- [x] Bootstrap-or-admin write policies on the tables the wizard populates
- [x] Insert-only bootstrap policies on `user_tags`/`user_levels` (0002's admin-only policies can't cover the exact insert that grants the *first* admin their tag)

### Authorization (`0002_functions_and_rls.sql`)
- [x] Helper functions: `my_rank`, `has_tag`, `is_hod_of`, `is_mentor_of`, `has_dashboard_access`, `has_mfa`, `is_base_level`
- [x] RLS enabled + forced on every user-data table
- [x] Policies for profiles, requests, comments, participants, attachments, watchers, canvas, signatures, dashboard grants, assignment history
- [x] `add_mandatory_watchers()` trigger
- [x] `block_student_internal_comment()` trigger
- [x] `schedule_attachment_purge()` trigger
- [x] `check_allowed_domain()` trigger

### Seed Data (`supabase/seed.sql`) — demo/reference only, see its header
- [x] 5 priority levels
- [x] 7 core function tags
- [x] Full OD category tree (Tech: Hackathon/Symposium/Conference/Placement/Others; Non-Tech: Clubs/Campus Life/Others)
- [x] Achievement Log category tree (Online Cert/Workshop/Non-OD Event)
- [x] First-hop picker options for every OD subcategory
- [!] **Not for real deployments.** A real instance gets exactly one account
  (the captain) from the wizard; every level/department/tag/category after
  that is created by hand, by a human at the right level — see README.md
  "No Fixture Data". This file exists as a worked example / disposable demo
  fixture only.

### Setup Wizard (`app/src/components/wizard/SetupWizard.tsx`, `app/src/lib/wizard.ts`)
- [x] First-boot detection — `is_bootstrapping()` RPC, not "are priority_levels empty" (that would break the moment `seed.sql` is loaded on a demo instance — see above)
- [x] Step 1: create the captain account (the only account created outside the normal sign-up flow)
- [x] Step 2: force TOTP MFA enrollment, no skip — verified live: challenge/verify round-trip works, session reaches `aal2`
- [x] Step 3: configure `allowed_login_domains`
- [x] Step 4: priority levels, initial tags, first request category — departments/extra tags are optional, captain adds the rest by hand afterward
- [x] End-to-end verified against a real docker-compose stack (see DEPLOY.md) — signup → MFA → domains → org setup → logout → login → MFA re-challenge → dashboard shell, all real network calls, zero mocked data

### Frontend (`app/`)
- [x] Vite + React + TS scaffold, Supabase JS client wiring (`app/src/lib/supabase.ts`)
- [x] Session handling / bootstrap flow (`app/src/App.tsx`) — wizard vs. login vs. dashboard shell
- [x] Login with mandatory TOTP challenge (checks for `aal2` before proceeding)
- [ ] MFA enrollment gate for non-captain accounts — only the wizard's captain path exists so far; there's no ordinary sign-up flow yet since accounts are created by an admin/Dean/HOD by hand, not self-registered (student self-registration is the exception — still not built)
- [ ] Student: request creation flow (category picker → first-hop picker → form → submit)
- [ ] Student: my requests, activity panel
- [ ] Staff: approval queue, search-and-forward UI
- [ ] Staff: internal notes, canvas
- [ ] HOD/Dean: dashboard (department counts, drill-down)
- [ ] Admin/Captain: priority levels, tags, categories, field definitions, dashboard grants management, and — new, per the real org model — cascading account creation (Captain creates Dean, Dean creates HOD, HOD creates Mentor/Student/Student Outreach Faculty)

---

## Known Gaps — Flagged Deliberately, Not Discovered Later

These exist in the schema/design but the implementation isn't finished. Each one is called out in SECURITY.md and/or NOTE.md — this isn't a secret backlog, it's what's explicitly incomplete right now.

- [!] `signature_assets` read policy is broader than it should be — any staff member can read anyone's signature, not just the document-generation process (SECURITY.md R-26)
- [!] `is_base_level()` assumes the highest rank is always Student — untested against a restructured hierarchy (SECURITY.md R-27)
- [!] Attachment purge trigger marks rows (`purge_after`) but nothing deletes them yet — no job reads `attachments_pending_purge` (SECURITY.md R-24)
- [!] Upload MIME-sniffing / re-encoding pipeline is designed (ARCH.md §6.4) but not implemented — uploads currently have no server-side content validation
- [!] Custom field values (`request_field_values.value`) have no runtime validation against `field_definitions` yet — needs a Zod-equivalent check in the API layer
- [!] `garage/garage.toml`'s `rpc_secret` is a hardcoded placeholder string, not actually substituted from `GARAGE_RPC_SECRET` — harmless for single-node (RPC only matters for clustering) but dead/misleading config, worth fixing before this ever becomes multi-node
- [!] Garage bucket/key provisioning (`basecamp-files` bucket, layout assignment, access key creation) has not been done or verified against a running instance — DEPLOY.md documents the standard Garage v1 CLI steps but they are **not live-tested** the way the wizard flow is. Verify before any real upload flow depends on it.

---

## Not Started

### Frontend (remaining — Setup Wizard and initial scaffold are Done, above)
- [ ] Student: request creation flow (category picker → first-hop picker → form → submit)
- [ ] Student: my requests, activity panel
- [ ] Staff: approval queue, search-and-forward UI
- [ ] Staff: internal notes, canvas
- [ ] HOD/Dean: dashboard (department counts, drill-down)
- [ ] Admin: priority levels, tags, categories, field definitions, dashboard grants management

### Document Generation
- [ ] Signature capture UI — canvas draw + image upload
- [ ] Signature cleaning pipeline (background removal, crop, sharpen) → `signature_assets`
- [ ] Annexure 4.4 template + field mapping
- [ ] NOC template + field mapping
- [ ] PDF rendering service, stamping `signature_assets` into the template
- [ ] `generated_documents` row creation with `reference_code` + `state_hash`
- [ ] Public verification page — look up a reference code, confirm authenticity

### Storage Pipeline
- [ ] Upload endpoint: MIME sniffing, allowlist check against `field_definitions`
- [ ] Image re-encoding (EXIF strip, resize, WebP)
- [ ] PDF linearization/compression
- [ ] Attachment purge job — reads `attachments_pending_purge`, deletes from Garage, removes the row
- [ ] Offsite encrypted backup sync (Garage → R2/B2)
- [ ] **Backup restore drill to a clean host — go-live gate, do not skip**

### Hardening
- [ ] Confirm the Postgres role PostgREST connects as isn't superuser / doesn't have `BYPASSRLS`
- [ ] Per-user upload quota — pick a number, enforce it
- [ ] Narrow the `signature_assets` read policy
- [ ] Add the `is_base_level()` hierarchy-shape regression test
- [ ] Automated cross-user RLS test suite — every table, every role combination
- [ ] `gitleaks` pre-commit hook + CI
- [ ] Frontend bundle scan for accidentally-embedded service role key
- [ ] External port scan of the VPS — confirm only Cloudflare's path is reachable

---

## Suggested Build Order

1. **Setup wizard + MFA gate** — nothing else is safely usable without this
2. **Storage pipeline basics** (MIME sniffing, re-encoding) — before any real file leaves a browser
3. **Student request flow + staff approval queue** — the core loop, Tech/Hackathon OD end to end
4. **Backup + restore drill** — before any real student data goes anywhere near this
5. **Signature capture + document generation** — Annexure 4.4 first, NOC second (same pattern)
6. **Dashboards, canvas, remaining hardening items** — once the core loop is proven

Steps 1, 2, and 4 are gates, not just early items — don't let real data flow before they're solid.
