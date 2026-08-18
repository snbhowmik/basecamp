# SECURITY — Threat Model & Risk Register
**Basecamp v1.0.0**
**Last Updated:** 2026-08-11
**Review Cadence:** monthly during build, quarterly in production

> The previous version of this register was written for a custom Keycloak + hand-built authorization stack. Moving to self-hosted Supabase **removes** a large category of risk (a custom-built authz engine that has to be proven correct) and **adds** a smaller, more contained one (getting Supabase's own RLS/storage/MFA configuration right). This register reflects that shift.

---

## 1. What Changed

| Previous version's problem | Now |
|---|---|
| Building and proving correct a custom two-layer authorization system | Gone — RLS is Supabase's own, well-trodden mechanism |
| Running and hardening Keycloak | Gone — GoTrue handles auth, smaller surface |
| No public inbound ports, complex tunnel setup | Simplified — Cloudflare proxy in front of the Supabase stack |
| Custom object storage pipeline | Mostly gone — Supabase Storage handles signing; only the R2 backend config and the optimization Edge Function are new |
| **New:** getting RLS policies exhaustively correct across every table | The main remaining risk — same as it was in the very first version of this project |
| **New:** external object storage credentials (R2) | A new critical secret that didn't exist before |

---

## 2. Asset Inventory

| Asset | Sensitivity | Notes |
|---|---|---|
| Postgres data volume | 🔴 Critical | All requests, profiles, internal comments |
| `request_comments` where `visibility = 'internal'` | 🔴 Critical | Faculty deliberation about named students |
| `signatures` | 🔴 Critical | Evidentiary approval record, append-only |
| `signature_assets` | 🟠 High | Each person's registered signature stamp — used on every generated document going forward |
| `generated_documents` | 🟠 High | Reference codes and state hashes that make Annexure 4.4/NOC output verifiable |
| Garage volume (self-hosted object storage) | 🔴 Critical | Where certificates actually live now — see §6, single point of failure without offsite backup |
| Supabase service role key | 🔴 Critical | Bypasses RLS entirely — must never reach the frontend |
| GoTrue JWT signing secret | 🔴 Critical | Compromise = forge any session |
| Garage RPC secret + access keys | 🔴 Critical | Full access to every uploaded certificate |
| Offsite backup encryption key (R2/B2) | 🔴 Critical | Must not live on the same VPS being backed up |
| `dashboard_grants` table | 🟠 High | Tampering exposes department-level data to the wrong people |
| `user_tags` / `user_levels` | 🟠 High | This IS the permission system — tampering is privilege escalation |
| `request_participants` (parent consent fields) | 🟠 High | Contains guardian name and contact for participants — no longer a file, but still sensitive data about minors' families |
| `allowed_login_domains` | 🟡 Medium | Tampering could open signup to unintended domains — now enforced at the trigger level, see R-10 |
| VPS SSH access | 🔴 Critical | Full host compromise |

---

## 3. Risk Register

**Score = Likelihood (1–5) × Impact (1–5)**

### 3.1 Authorization

| ID | Threat | Vector | L | I | Score | Status | Mitigation |
|---|---|---|---|---|---|---|---|
| **R-01** | RLS policy gap on some table lets one user read another's data | A table gets `ENABLE ROW LEVEL SECURITY` but no policy, or an incomplete policy | 3 | 5 | **15 🔴** | Mitigating | Every table audited against a checklist before launch; automated cross-user test suite (see §6) runs on every schema change |
| **R-02** | `postgres`/API role owns tables → RLS silently bypassed | Migrations run as the wrong role | 2 | 5 | **10 🟠** | **Mitigated — verified 2026-08-09** | Confirmed against a live instance: `postgres` does NOT carry `SUPERUSER` in `supabase/postgres:15.1.0.147` — only `supabase_admin` does (that's who migrations must run as; see DEPLOY.md). PostgREST connects as `authenticator`, which has no login rights of its own and role-switches to `anon`/`authenticated` per-request — neither carries `SUPERUSER` or `BYPASSRLS` (`\du` output, both show `Cannot login` and no bypass attribute). `FORCE ROW LEVEL SECURITY` remains applied on every table as the backstop regardless. |
| **R-03** | Internal comment leaks to a student | Policy logic error in `comments_visibility`, or a student somehow holds `my_rank()` above base | 3 | 5 | **15 🔴** | Mitigating | Single, simple policy (`visibility = 'public' or my_rank() < max(rank)`) — deliberately kept minimal to reduce the chance of a subtle bug; dedicated automated test |
| **R-04** | A relationship-check function (`is_hod_of`, etc.) has a bug, and every policy using it inherits it | The centralisation that prevents drift also means one bug is now everywhere at once | 2 | 4 | **8 🟡** | Mitigating | Each helper function gets its own dedicated unit test with positive and negative cases, run before any policy depending on it is trusted |
| **R-05** | Student self-grants a tag or level via a write path | Missing RLS write policy on `user_tags`/`user_levels` | 2 | 5 | **10 🟠** | Mitigated | Write policies on both tables require `has_tag('admin')`; no other path exists |
| **R-06** | `dashboard_grants` tampered with to expose a department's data | Missing or wrong RLS on the grants table itself | 2 | 4 | **8 🟡** | Mitigated | Write policy requires `has_tag('admin')`; read policy is self-only |

### 3.2 Identity & MFA

| ID | Threat | Vector | L | I | Score | Status | Mitigation |
|---|---|---|---|---|---|---|---|
| **R-07** | User reaches sensitive functionality before completing MFA enrollment | Frontend redirect logic has a gap | 3 | 4 | **12 🟠** | Mitigating | Frontend gate is UX only; the real control is `has_mfa()` in every sensitive RLS policy — a backend enforcement that doesn't depend on frontend routing being correct |
| **R-08** | GoTrue JWT secret leaked | Misconfigured env var, committed secret | 2 | 5 | **10 🟠** | Mitigating | Docker secrets, not env files; `gitleaks` in CI |
| **R-09** | Credential stuffing on student accounts | Reused breached passwords | 4 | 2 | **8 🟡** | Mitigating | GoTrue rate limiting + Cloudflare rate limiting in front |
| **R-10** | Someone outside the allowed domains registers anyway | Bug in domain-check logic, or check only enforced client-side | 2 | 3 | **6 🟡** | **Mitigated** | Enforced by `check_allowed_domain()` trigger directly on `auth.users` insert — rejects at the lowest layer, cannot be bypassed by calling the GoTrue API directly and skipping the frontend |

### 3.3 Infrastructure

| ID | Threat | Vector | L | I | Score | Status | Mitigation |
|---|---|---|---|---|---|---|---|
| **R-11** | VPS host compromise | Unpatched OS, exposed service | 3 | 5 | **15 🔴** | Mitigating | Cloudflare proxy in front; SSH key-only; unattended upgrades; fail2ban |
| **R-12** | Service role key exposed in the frontend bundle | Accidentally using it instead of the anon key | 3 | 5 | **15 🔴** | Open | CI check: `grep` the built frontend bundle for the service role key pattern; must return nothing |
| **R-13** | Garage credentials leaked (RPC secret, S3 access keys) | Committed to git, plain env file | 2 | 5 | **10 🟠** | Mitigating | Docker secrets, not env files; `gitleaks` in CI |
| **R-14** | Backup never tested, fails when actually needed | No restore drill performed | 2 | 5 | **10 🟠** | Open | Restore drill to a clean host is a go-live gate |
| **R-21** | Garage single-node data loss | Disk failure on the VPS's attached volume, no built-in replication (`replication_mode = "none"`) | 2 | 5 | **10 🟠** | Open | This is the accepted cost of self-hosting storage rather than using a managed provider — the offsite encrypted backup to R2/B2 is the only mitigation and is not optional. **Restore drill is the test that actually proves this works**, not just that backups run. |
| **R-22** | Offsite backup encryption key stored on the same VPS it protects | Convenience during setup | 2 | 5 | **10 🟠** | Open | The key must live somewhere else entirely — a password manager, a separate secrets service — or the backup is worthless the moment the VPS itself is compromised or destroyed |

### 3.4 Files & Storage

| ID | Threat | Vector | L | I | Score | Status | Mitigation |
|---|---|---|---|---|---|---|---|
| **R-28** | `request_field_values` had **no RLS at all** — every custom field value on every request readable and writable by any authenticated user | Table was missed by both 0002 (which covered the other request tables) and 0003 (which covered the catalog tables); PostgREST exposes anything in `public` | 3 | 4 | **12 🟠** | **Mitigated 2026-08-11** | Found while building the V2 request flow. RLS enabled + forced in `0006_requests_and_org.sql`, reads gated by `can_see_request()`, writes limited to the request's owner. **Lesson: "enable RLS on every user-data table" needs to be an enumerated checklist checked against `pg_tables`, not a list maintained by hand** — see test #12 below. |
| **R-31** | Container escape from Mailcow's internet-facing PHP stack to host root, reaching the Postgres instance holding student records | Kernel `6.8.0-137` flagged likely-vulnerable to CVE-2026-43284 (xfrm-ESP) and CVE-2026-43500 (rxrpc), with `kernel.unprivileged_userns_clone=1`. Mailcow (SOGo, php-fpm, admin UI) publishes 11 ports and shares a kernel with `basecamp-db` | 2 | 5 | **10 🟠** | **Open — mitigations in DEPLOY.md §C.3** | Disable unprivileged user namespaces or blacklist `esp4`/`esp6`/`rxrpc`; keep the kernel patched. **The structural fix is not co-hosting mail and the app** (DEPLOY.md §C.5) — RLS protects rows from API callers, not from a process that owns the host. Found by a LinPEAS audit on 2026-08-18. |
| **R-32** | Secrets recoverable from shell history and a world-readable `.env` on the host | `.bash_history` contained `SMTP_PASS` in cleartext from a `sed -i` one-liner; `.env` holds `JWT_SECRET`, which mints `service_role` tokens that bypass RLS entirely | 3 | 5 | **15 🔴** | **Open — rotate on rebuild (DEPLOY.md §C.2)** | Rotate every secret; never restore an old `.env` onto a rebuilt host. Set secrets by editing the file, not via commands the shell records. Longer term these belong in Docker secrets rather than a plaintext env file, as `.env.example`'s own header already says. |
| **R-29** | Compromise of the `mailer` container discloses pending invite tokens, letting an attacker claim an invited staff role before its intended holder | `services/mailer` connects as `basecamp_mailer` and calls `claim_invite_emails()`, which returns live `invite_token` values and email addresses | 2 | 4 | **8 🟡** | **Accepted, bounded by design** | The role holds **no table privileges** and exactly three function grants — it cannot create a user, read a request, or bypass RLS, and holds no `service_role` key (NOTE.md 2026-08-18). Container publishes no port and Kong has no route to it. Residual risk is invite-token disclosure only. Narrowing further would mean the mailer never seeing the token, which requires GoTrue's admin invite API and therefore `service_role` — strictly worse. **Revisit if invites ever carry more than level/tag pre-assignment.** |
| **R-30** | Invite email delivered over plaintext SMTP, exposing the token in transit | The mailer speaks to the same relay GoTrue uses; a relay that stops offering STARTTLS would otherwise be silently downgraded to cleartext | 2 | 4 | **8 🟡** | **Mitigated** | `requireTLS` is set on the nodemailer transport, so the STARTTLS upgrade is mandatory rather than best-effort — a relay that stops offering it fails the send loudly instead of leaking the token. Verified against `mail.hackerxploit.org:587` (`openssl s_client -starttls smtp` → `Verify return code: 0`). |
| **R-15** | Malicious file upload (polyglot, embedded payload) | Crafted certificate image/PDF | 3 | 4 | **12 🟠** | Open | Designed but **not yet implemented** — the re-encoding/sniffing pipeline described in ARCH.md §6.4 doesn't exist as code yet |
| **R-16** | Storage cost/volume runaway | No per-user quota; someone uploads relentlessly | 2 | 3 | **6 🟡** | Open | Per-file size cap; per-user upload rate limit — not yet specified, needs a number |
| **R-23** | Parent consent falsely recorded | Mentor marks consent verified without actually calling the parent | 3 | 4 | **12 🟠** | Accepted | This is now a trust-and-accountability control, not a document-forgery control — `parent_consent_verified_by` and `parent_consent_verified_at` create a named, timestamped record of who attested to the call, which is the same level of accountability a physical signature line offered, just without a document to physically forge |
| **R-24** | Attachment purge trigger marks rows but nothing deletes them | `schedule_attachment_purge()` sets `purge_after`; no job reads it yet | 4 | 2 | **8 🟡** | **Open — known gap** | Not a security risk in the traditional sense, but a data-minimization commitment (PRD §10.4) that currently isn't honored. OD evidence sits in Garage indefinitely until the purge job is built. Flagged explicitly rather than left to look finished. |
| **R-25** | Generated document (NOC, Annexure 4.4) spoofed outside the system | Someone crafts a fake PDF with a real-looking reference code | 2 | 3 | **6 🟡** | Mitigated by design | The `reference_code` is only meaningful if checked against `generated_documents.state_hash` — a spoofed PDF with an invented code fails that lookup. Requires a public verification page to actually be useful; not yet built. |

### 3.5 Application Logic

| ID | Threat | Vector | L | I | Score | Status | Mitigation |
|---|---|---|---|---|---|---|---|
| **R-18** | Achievement (log-only) request mislabeled to skip approval | Someone submits a Tech OD-equivalent thing under a log-only category to avoid needing HOD sign-off | 3 | 3 | **9 🟡** | Open | Category tree is admin-controlled, not user-selectable arbitrarily; still worth a periodic audit query — "log-only requests that look like they should have needed approval" — flagged as a report to build |
| **R-19** | Signature forged or replayed | Approve action taken without a genuine, fresh MFA check | 2 | 5 | **10 🟠** | Mitigated | `has_mfa()` required on the update policy that transitions status to `approved`; `signatures` append-only |
| **R-20** | Search-and-forward used to route a request somewhere inappropriate | No constraint on who can be forwarded to | 2 | 3 | **6 🟡** | Accepted | By design, this is intentionally open — any staff member can forward to any other. Logged in `request_assignment_history` for accountability after the fact rather than restricted upfront. |
| **R-26** | Any staff member can read anyone's stored signature image, not just the document-generation process | `signature_assets_read_staff` policy in `0002_functions_and_rls.sql` is broader than necessary — a mentor could fetch the Dean's signature PNG directly rather than it only being used internally to stamp documents | 3 | 4 | **12 🟠** | **Open — known gap, flagged at build time** | Needs narrowing so signature assets are readable only by the document-generation process (a `security definer` function or Edge Function), not by any authenticated staff member browsing the table directly |
| **R-27** | `is_base_level()` assumption breaks if a level is inserted below Student | The function assumes the highest `rank` value is always the student level; every policy using it inherits the assumption | 2 | 4 | **8 🟡** | **Open — known gap, flagged at build time** | Needs a test that fails loudly if `priority_levels` is ever modified in a way that breaks this assumption, rather than silently misclassifying who counts as "base level" |

---

## 4. Threat Actors

Unchanged in substance from the previous version — **student threat likelihood remains rated High, not Medium.** This is a Cyber Security department; assume the platform will be probed by people with real skill and real motive to test it.

---

## 5. Attack Surface Map

```
Public:        signup (domain-restricted), login, MFA challenge
Student:       own requests, own comments (public only), own uploads
Staff:         approval queue, internal comments, search-and-forward,
               dashboard (if granted), canvas
Admin:         priority levels, tags, categories, domains, dashboard_grants,
               user management
```

Every one of these is an RLS policy, not an application-layer check layered on top of a permissive database — that's the entire point of this foundation.

---

## 6. Pre-Production Test Plan

| # | Test | Pass Condition | Status |
|---|---|---|---|
| 1 | Cross-user `SELECT` sweep — every table, every role combination | No unauthorized row ever returned | 🔲 |
| 2 | Student session requests an internal comment | Zero returned, every time | 🔲 |
| 3 | Student attempts to write `user_tags`/`user_levels` for themselves | Denied | 🔲 |
| 4 | Dean with 3-department grant queries all requests | Only those 3 departments' data returned | 🔲 |
| 5 | Sensitive write attempted with `aal1` session (no MFA) | Denied by `has_mfa()` | 🔲 |
| 6 | Registration attempt from a non-allowed domain | Rejected server-side, not just client-side | 🔲 |
| 7 | Malicious file upload (polyglot, EICAR) | Rejected or neutralised by re-encoding | 🔲 |
| 8 | Service role key search across the built frontend bundle | Not found | 🔲 |
| 9 | `is_hod_of()` / `is_mentor_of()` unit tests, positive and negative cases | All pass | 🔲 |
| 10 | Backup restore to a clean host | Full recovery verified | 🔲 |
| 11 | External port scan of the VPS | Only what Cloudflare needs is open | 🔲 |
| 12 | Enumerate `pg_tables` in `public` and assert every one has `rowsecurity = true` | No table without RLS | 🔲 |
| 13 | Student session calls `decide_request()` / `forward_request()` on someone else's request | Rejected — not the current holder | 🔲 |
| 14 | `create_and_submit_request()` called with a forged requester | Impossible by construction — `requested_by` is `auth.uid()`, not a parameter | 🔲 |

---

## 7. Open Security Questions

| # | Question | Priority |
|---|---|---|
| ~~1~~ | ~~Confirm which Postgres role Supabase's own tooling uses for migrations, and that it isn't superuser at runtime~~ — **Resolved 2026-08-09.** See R-02. Migrations must run as `supabase_admin`; `postgres` alone can't even `ALTER` the reserved `authenticator` role. | — |
| ~~2~~ | ~~Domain allowlist enforcement~~ — **Resolved.** `check_allowed_domain()` trigger, see R-10. | — |
| 3 | Per-user upload quota — what's the actual number? (R-16) | 🟠 Medium |
| 4 | Backup destination and encryption key custody — still unresolved, and now more urgent since Garage holds the only copy of every certificate (R-14, R-21, R-22) | 🔴 High |
| 5 | Should there be a periodic audit report for R-18 (log-only requests that look approval-shaped)? | 🟡 Low |
| 6 | Narrow the `signature_assets` read policy so it's not readable by any staff member browsing the table (R-26) | 🟠 Medium |
| 7 | Build the actual purge job that reads `attachments_pending_purge` and deletes from Garage — the trigger currently only marks rows (R-24) | 🟠 Medium |
| 8 | Build the public verification page for `generated_documents.reference_code` — the mechanism exists in the schema but nothing surfaces it yet (R-25) | 🟡 Low |
| 9 | Where does the attached, growable block volume for Garage actually get provisioned — depends on the still-open VPS provider decision | 🔴 High |
