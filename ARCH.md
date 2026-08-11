# ARCH — Architecture & Data Design
**Basecamp v1.0.0**
**Last Updated:** 2026-08-11

> This document describes what's actually in `supabase/migrations/` and `docker-compose.yml` — not a target design. Where something here and the code disagree, the code is right and this needs updating.

---

## 1. Why Self-Hosted Supabase

`auth.uid()` is the whole point. Earlier designs for this project moved to a custom VPS + Keycloak + hand-built authorization engine, which meant no per-user JWT ever reached Postgres, and every RLS policy had to be replaced with a two-layer system built from scratch — the highest-risk, highest-effort piece of that design.

Self-hosted Supabase is the same open-source stack (Postgres, GoTrue, PostgREST, Storage, Realtime, Studio) in Docker Compose on your own VPS:

- **Self-hosted** — own infrastructure, own control.
- **`auth.uid()` works** — GoTrue issues the JWT, PostgREST forwards it, Postgres verifies it. RLS is a real, enforced boundary — see `0002_functions_and_rls.sql`.
- **MFA is native** — TOTP enrollment and `aal1`/`aal2` session claims are built into GoTrue.
- **No custom API server** — PostgREST generates a REST API from the schema directly.

---

## 2. Topology

```
Cloudflare (DNS + proxy)
        │
        ▼
VPS — docker-compose.yml
   ┌─────────────────────────────────────────┐
   │ kong      — the ONLY port reachable,     │
   │             and only via Cloudflare       │
   │ auth      — GoTrue: signup, MFA, JWTs    │
   │ rest      — PostgREST: auto REST API     │
   │ realtime  — live subscriptions            │
   │ storage   — file metadata + signed URLs   │
   │ db        — Postgres, RLS-enforced         │
   │ studio    — admin DB browser, internal-only│
   │ garage    — self-hosted object storage     │
   └─────────────────────────────────────────┘
```

Frontend: a static SPA served from Cloudflare Pages, using the Supabase JS client directly against Kong. No BFF, no Worker.

Only `kong` publishes a port, and it's bound to `127.0.0.1:8000` — reachable only through whatever's proxying in front of it (Cloudflare Tunnel or a reverse proxy on the same box), never directly from the internet. Everything else — `db`, `garage`, `studio` — sits on the internal Docker network with no published port at all.

---

## 3. Database Schema

Full DDL lives in `supabase/migrations/0001_schema.sql`. Summary by concern:

### 3.1 Identity

`profiles` mirrors `auth.users`, extended with `mfa_enrolled` (kept in sync by a trigger on `auth.mfa_factors`) and `is_active`. A trigger on `auth.users` insert (`handle_new_user`) creates the profile row automatically.

### 3.2 Hierarchy — Not a Role Enum

`priority_levels` — ordered by `rank` (1 = highest authority). `tags` — free-form, admin-managed. `user_tags` and `user_levels` — the actual permission assignments. Seeded starting shape (`supabase/seed.sql`):

```
Rank 1  Dean-level
Rank 2  HOD-level
Rank 3  Coordinator-level
Rank 4  Mentor-level
Rank 5  Student (base)
```

Two people at the same rank do different jobs, distinguished by tags (`hod` + a department tag vs `hod` + a different department tag). `departments` and `classes` each carry a `tag_id` — the tag that means "belongs to this org unit" — which is what the relationship-check functions (§4) join against.

### 3.3 Request Taxonomy

`request_types` → `request_categories` (self-referencing tree, unbounded depth) → `category_first_hop_options` (the picker). Two request types are seeded: `od_request` (decision_mode `approval`) and `achievement` (decision_mode `log_only`) — see PRD §8 for what that distinction means functionally.

Each category also carries `retain_attachments_after_close`: `false` for OD categories, `true` for Achievement categories. This is what the purge trigger (§5.3) reads.

`field_definitions` + `request_field_values` give any category custom fields without a schema change — values are typed `jsonb`, validated against the definition in the application layer (Postgres can't enforce this; logged as an accepted tradeoff).

### 3.4 Requests

`requests` is the core table. `decision_mode` is copied from the category at creation and never changes afterward — this is deliberate, so a category's mode can be edited later without silently altering requests already in flight.

`current_holder` is whoever has it right now. `request_assignment_history` is the append-only trail of every forward — who, to whom, when, what action. There is no preset workflow graph; routing is the picker for the first hop, then open search-and-forward, logged.

`request_watchers` holds Mentor and HOD, added unconditionally by the `add_mandatory_watchers()` trigger the moment a request transitions to `submitted`. This does not depend on who the request was routed to — it fires regardless.

### 3.5 Signatures, Consent, and Generated Documents

This is the part that changed most from earlier designs, based directly on how the institution actually works:

- **`signatures`** — one row per approval-flow decision (approve/reject/changes-requested), append-only (triggers block `UPDATE` and `DELETE`), carrying a `state_hash` of the request at the moment of signing.
- **`signature_assets`** — a person's *stamp*, not a per-document signature. Registered once (drawn on a canvas or uploaded and cleaned), reused on every generated document that needs their signature. `one_active_signature_per_user` enforces exactly one active stamp per person.
- **`request_participants`** — for outstation OD, this is where **parent consent lives as a structured record**, not a file: `parent_consent_verified`, `parent_consent_verified_by`, `parent_name`, `parent_contact`, `transport_mode`. The Mentor calls the parent, confirms, and fills this in. There is no undertaking document anywhere in the schema.
- **`generated_documents`** — Annexure 4.4 and NOC are the same pattern: a `reference_code` printed on the output, a `state_hash`, and the `signature_ids` that were stamped in. The `cached_object_key` is optional and disposable — the row is the source of truth, the PDF is a rendering of it that can be regenerated identically at any time.

### 3.6 Attachments and Their Lifecycle

`request_attachments` carries a `purge_after` timestamp, `null` by default. The `schedule_attachment_purge()` trigger (§5.3) sets it when a request closes, based on the category's `retain_attachments_after_close` flag. OD evidence (posters, letters, receipts) gets a 7-day grace period then deletion. Achievement uploads — certificates — never get `purge_after` set; they're permanent.

**This is the only category of file that needs to survive indefinitely.** Everything else — generated PDFs, OD evidence — is either regeneratable or intentionally temporary.

### 3.7 Comments, Canvas

`request_comments.visibility` is `public` or `internal`. The `block_student_internal_comment()` trigger makes it structurally impossible for a base-level (student) user to author an `internal` comment — not just a policy denying reads, a trigger denying the write outright. `canvases`/`canvas_revisions` inherit the same visibility split.

### 3.8 Dashboard Access

`dashboard_grants(user_id, department_id)` — a flat grant table, deliberately independent of `priority_levels` and `tags`. A Dean's dashboard scope is whichever departments this table says, decided by Admin, unrelated to their approval authority.

### 3.9 Domain-Restricted Signup

`check_allowed_domain()` runs as a trigger directly on `auth.users` insert — before a profile even exists. Someone hitting the GoTrue signup API directly, bypassing the frontend entirely, still gets rejected if their email domain isn't in `allowed_login_domains`. This was an open question in earlier notes; it's resolved by putting the check at the lowest possible layer rather than trusting the UI.

---

## 4. Authorization — Helper Functions

`0002_functions_and_rls.sql`. The rule: any relationship check gets written once as a `security definer` SQL function and reused everywhere. Never inline the same join in multiple policies.

```sql
my_rank()                        -- caller's priority rank
has_tag(tag_code)                 -- does the caller hold this tag
is_hod_of(dept_id)                 -- HOD of a specific department
is_mentor_of(class_id)               -- mentor of a specific class
has_dashboard_access(dept_id)          -- explicit grant, not derived from rank/tags
has_mfa()                                -- session carries aal2
is_base_level()                            -- shorthand for "is a student"
```

Every RLS policy in the file calls these rather than repeating the underlying joins. If the definition of "HOD of a department" ever needs to change, it changes in one function and every policy using it is automatically correct.

`FORCE ROW LEVEL SECURITY` is applied on every user-data table, not just `ENABLE` — the latter doesn't apply to a table's owner, and if the connecting role ever turns out to own the tables, plain `ENABLE` would be silently bypassed.

---

## 5. Triggers Doing Real Work

### 5.1 `add_mandatory_watchers()`
Fires on submit. Resolves the requester's mentor and HOD via their class/department tags, inserts both into `request_watchers` unconditionally.

### 5.2 `block_student_internal_comment()`
Fires on `request_comments` insert. Raises if a base-level user attempts `visibility = 'internal'`.

### 5.3 `schedule_attachment_purge()`
Fires when `requests.status` transitions to `closed`. Checks the category's `retain_attachments_after_close`; if false, stamps every attachment on that request with `purge_after = now() + 7 days`.

**Important gap, called out deliberately:** this trigger only marks rows. Nothing in the current schema actually deletes the object from Garage or removes the row once `purge_after` has passed — that's an external scheduled job reading `attachments_pending_purge` (the partial index on this column), calling the Storage API to delete, then removing the row. Not yet built. See TASK.md.

### 5.4 `check_allowed_domain()`
Fires on `auth.users` insert. Rejects signup if the email domain isn't in `allowed_login_domains`.

### 5.5 Append-only enforcement
`signatures_no_update` / `signatures_no_delete` raise unconditionally on `UPDATE`/`DELETE` against `signatures`. This can't be bypassed by a careless `GRANT` later — it would take dropping the trigger itself, which the runtime role shouldn't have permission to do.

---

## 6. Storage

### 6.1 Garage as Primary, Not Local Disk, Not R2

Files live in **Garage**, self-hosted, on a Docker volume that should be mounted on a separately attached, independently growable block volume — not the VPS boot disk. `garage/garage.toml` configures single-node operation (`replication_mode = "none"`); Supabase's `storage-api` service points at it as its S3-compatible backend (`docker-compose.yml`, `storage` service environment).

This was a deliberate reversal from an earlier plan to use Cloudflare R2 as primary storage — R2 (or Backblaze B2) is used now **only as an encrypted offsite backup target**, not live storage. Garage being self-hosted was weighed as more consistent with the actual goal (self-hosting, not depending on a third-party API for the thing users touch constantly) at the accepted cost of owning durability directly rather than inheriting it from a managed provider.

### 6.2 The Durability Tradeoff, Explicitly

Single-node Garage has no built-in replication. A disk failure loses everything on it. This is why the offsite encrypted backup isn't optional polish — it's the only thing standing between a hardware failure and losing every student's certificates. **A backup that's never been restored is a hypothesis, not a backup** — the restore drill is a go-live gate (SECURITY.md, TASK.md).

### 6.3 What Actually Needs Protecting

Narrower than it looked a few iterations ago:

| | Needs real backup discipline | Why |
|---|---|---|
| Certificates | **Yes** | Irreplaceable, permanent, the only thing `retain_attachments_after_close = true` applies to |
| OD evidence attachments | No | Auto-purged 7 days after ticket close; transient by design |
| Generated PDFs (Annexure 4.4, NOC) | No | Regeneratable from `generated_documents` + `signature_assets` + the request row |
| `signature_assets` | Mildly | Losing one means re-registering a stamp; not catastrophic, but worth including in backups since it's small |

### 6.4 Upload Pipeline

Not yet implemented as code (flagged in TASK.md), but designed as: sniff real MIME type server-side, reject on mismatch with the field's allowlist, re-encode images to WebP with EXIF stripped, linearize and compress PDFs. No exceptions remain in this pipeline — since parent consent is a database record now, not a file, there's no "preserve byte-for-byte" special case anymore.

---

## 7. Architecture Decision Record

| Decision | Rationale |
|---|---|
| Self-hosted Supabase over custom Keycloak+Node | Restores `auth.uid()`/RLS as a real boundary without building and proving correct a custom authorization engine from scratch. |
| Priority levels + tags over a fixed role enum | Two people at the same rank can hold entirely different jobs; tags carry that distinction without a schema change per org. |
| `decision_mode` copied onto the request, not looked up live | A category's mode changing later must not silently alter requests already in flight. |
| Parent consent as a structured record, not a file | The institution's actual process is a phone call and a verbal confirmation — there was never a scanned document to preserve. |
| Generated documents are cache, not source of truth | Annexure 4.4 and NOC can be recreated identically from data already in the database plus a stored signature. The `state_hash` + `reference_code` protect authenticity; the PDF file itself is disposable. |
| One stored signature asset per person, reused everywhere | Matches how physical signing actually worked — sign once, stamp is valid on every subsequent document — rather than re-collecting a signature per document. |
| Attachment retention is a per-category flag, not hardcoded | OD evidence is transient by nature; achievements are permanent by nature. A future category might need either behavior. |
| Garage self-hosted as primary, cloud storage as backup-only | Consistent with the project's actual goal (self-hosting), at the cost of owning durability directly — mitigated by treating the offsite backup as load-bearing, not optional. |
| Helper functions for every relationship check | Prevents the same join logic being duplicated and drifting across a dozen RLS policies. |
| `FORCE ROW LEVEL SECURITY` everywhere | Plain `ENABLE` doesn't apply to the table owner; forcing it is a backstop against a future misconfiguration silently disabling the whole authorization model. |
