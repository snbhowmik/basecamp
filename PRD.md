# PRD — Basecamp
**Version:** 1.0.0 (Self-Hosted Supabase Foundation)
**Status:** Architecture Locked — Building
**Last Updated:** 2026-03-01

> **Naming note:** "Basecamp" is also the name of an existing, actively sold commercial product (37signals). That's a non-issue for internal departmental use. It becomes a real trademark consideration only if this is ever distributed publicly or open-sourced under that name — worth a rename at that point, not before.

> **This is a generic, instantiable request/ticketing platform.** OD is the first thing it's configured to do — the way a ticket type is configured in Zoho or Freshdesk — not something built into the code. Everything in this document should read as "how the platform works," with OD as the running example.

---

## 1. Overview

A self-hosted request and task management platform, first deployed for SRM Trichy's Cyber Security Department, built so any department — or any other organisation — could stand up their own instance by walking through a setup wizard rather than editing code.

**Foundation:** self-hosted Supabase (Postgres + GoTrue + PostgREST + Storage + Realtime), on a VPS you control, with an external object storage service for files. Not managed Supabase, not a custom-built auth system.

---

## 2. Goals

- A working request platform, sized realistically for **8,000+ students** from day one.
- Self-hosted, single-org, but built generically enough that "another org" is a new setup-wizard run, not a rewrite.
- Two kinds of request: ones that need a real **decision** (approve/reject) and ones that just need to be **logged** (reviewed once, saved, no gate).
- People organised by ordered **priority levels** with **tags** for identity — not a fixed role list baked into code.
- Analytics dashboards for people whose job is oversight, not approval (Dean, and anyone Admin grants it to).
- Storage that survives 8,000 students uploading certificates for years, without drowning the VPS.

---

## 3. Non-Goals (This Version)

- A visual workflow-graph builder (Node-RED-style). The routing model here is simpler — a configurable picker plus search-and-forward — and covers everything currently needed. A graph builder is a future upgrade if the picker model turns out to be limiting.
- Multi-organisation / multi-tenant deployment. This is one org (SRM Trichy) with several valid login email domains — not several separate orgs sharing one deployment.
- SLA timers and auto-escalation.
- Notification delivery (email/SMS). Events are recorded; delivery is stubbed.
- Online OD for club events (students registering for a club event and getting OD automatically, no separate request). Noted for later.

---

## 4. Architecture Summary
*(Full detail in ARCH.md)*

| Layer | What | Why |
|---|---|---|
| Edge | Cloudflare (DNS + proxy only) | TLS, basic protection. No Worker, no BFF — nothing to build or maintain there. |
| Application | Self-hosted Supabase stack on one VPS: Postgres, GoTrue (auth), PostgREST (auto-generated API), Storage, Realtime, Studio | PostgREST reads the schema and gives you a REST API for free. No custom API server to write. |
| Data | The same Postgres, plus an **external** S3-compatible object store (Cloudflare R2) for files | Files must not live on the VPS's own disk — see §10. |

**The single biggest reason this foundation was chosen:** self-hosted Supabase restores `auth.uid()` inside Postgres, which means **Row Level Security is a real, database-enforced boundary again** — the same model as the very first version of this project, except self-hosted this time. No custom authorization engine to build and prove correct from scratch.

---

## 5. First-Boot Setup Wizard

On first run, before the application is usable:

1. **Create the admin account** — name, email, password.
2. **Enroll MFA for the admin** — TOTP, mandatory, cannot be skipped.
3. **Configure allowed login domains** — which email domains can sign up (e.g. `srmist.edu.in`, `trp.srmtrichy.edu.in`, `ist.srmtrichy.edu.in`). Anyone outside these domains cannot register.
4. **Configure the organisation** — name, priority levels, initial tags, departments, first request category (OD).

Only after all four steps does the platform accept ordinary sign-ups. This is a one-time flow, not something re-run per department.

---

## 6. Identity & Hierarchy

### 6.1 Priority Levels — Not Fixed Roles

People are organised into **ordered priority levels**, admin-configurable:

```
Level 1  — top (e.g. Dean, Principal)
Level 2  — department heads (e.g. HOD)
Level 3  — coordinators, officers (e.g. Club Coordinator, Placement Officer)
Level 4  — mentors / class advisors
Level 5  — base (students)
```

Levels can be inserted anywhere, renamed, or reordered by Admin. There is no code that says `if role === 'hod'` — the level number and its position relative to others is what matters (e.g. "must be reviewed by someone at Level 2 or above").

### 6.2 Tags — Identity Within a Level

Two people can be at the same level and do completely different jobs. **Tags** distinguish them and are how people are found and referenced:

- Two Level 2 people: one tagged `hod`, `dept:cs`; another tagged `hod`, `dept:ece`.
- A Level 4 mentor tagged `mentor`, `class:cse-a`.
- A Level 3 person tagged `club_coordinator`, `club:robotics`.

Tags are free-form, admin-managed, and many-to-many with users. Search-and-forward (§8) and department scoping (§9, §11) both work by matching tags.

### 6.3 What This Replaces

Earlier versions of this project used a fixed enum of roles (`student`, `mentor`, `hod`, `admin`...). That doesn't generalise — a new org might not have a "Dean," might have three levels between mentor and HOD, might call the HOD something else entirely. Level + tags is the general version of the same idea.

---

## 7. Authentication & MFA

- Login is email + password against Supabase Auth (GoTrue), restricted to the configured allowed domains.
- **MFA (TOTP) is mandatory for every user — not just staff.** Enforced at first login: a new user cannot reach any real screen until they've enrolled an authenticator app.
- Sessions that have completed MFA carry Supabase's `aal2` claim. Every sensitive action (approving, viewing internal notes, admin operations) requires `aal2`, checked at the database level — not just hidden in the UI.

---

## 8. Request Model

### 8.1 Two Decision Modes

Every request belongs to a category, and every category is configured with a **decision mode**:

| Mode | Meaning | Example |
|---|---|---|
| **Approval** | Needs a real decision — approve, reject, or send back for changes | OD requests |
| **Log-only** | Gets reviewed once (someone looks at it, marks it seen) and saved — nothing to approve or reject | Online certifications, workshop completions, achievements from events that didn't need OD |

This is the same distinction that was previously described as "certificate upload" — it isn't a separate system, it's a request with `decision_mode = log_only`. One request model, two behaviours.

### 8.2 Category Tree

```
OD Request  (decision_mode: approval)
├── Tech
│   ├── Hackathon
│   ├── Symposium
│   ├── Conference
│   ├── Placement
│   └── Others
└── Non-Tech
    ├── Clubs
    ├── Campus Life
    └── Others

Achievement Log  (decision_mode: log_only)
├── Online Certification
├── Workshop / Training
└── Non-OD Event
```

Categories are database rows with unbounded tree depth — Admin can add branches without a deploy.

### 8.3 Custom Fields

Each category can define its own extra fields (text, number, date, dropdown, file). Admin-configurable, no code changes required to add a field like "Prize Money" to Hackathon.

### 8.4 Travel Scope (Outstation)

Orthogonal to category: any approval-mode OD request is additionally **Internal** or **Outstation**. Outstation triggers the Annexure 4.4 form flow and a participant snapshot. Per-student parent consent (§14.2) replaces what was previously a scanned Parent Undertaking document — no file involved.

---

## 9. Routing

### 9.1 The Picker

Each **approval-mode** category has a configurable list of **suggested first-hop recipients**. For OD/Tech, that list is usually just "your Mentor," but the student can pick someone else from the list if the situation calls for it. Admin controls what appears in the picker, per category.

### 9.2 Search-and-Forward

After the first hop, whoever currently holds the request can forward it to **anyone** in the system by searching name or tag — not limited to a preset chain. Every forward is logged: who, to whom, when, with an optional note.

### 9.3 Default Watchers — Always On

Regardless of the actual routing, **the student's Mentor and their department's HOD are always added as watchers** the moment a request is submitted. This is unconditional — it does not depend on who the request was routed to. Watchers see the request and get notified; they are not blockers and don't need to act.

### 9.4 Log-Only Requests

Log-only requests don't route through an approval chain at all. They go to whoever is configured to review that category (e.g. HOD for achievements), that person looks it over and marks it **Reviewed**, and it's done. There's no reject state — at most, a reviewer can flag something as questionable, but the record is saved either way.

---

## 10. Storage Strategy

### 10.1 What Actually Needs to Live Forever

Only one category of file needs permanent, irreplaceable storage: **student-uploaded certificates and achievements.** Everything else that used to be a storage concern has been designed out or made disposable:

- **Parent consent** is now a verified record (§14.2), not a scanned document — no file at all.
- **Annexure 4.4 and NOC** are generated on demand from data already in the database plus a stored signature image (§14). The rendered PDF is a cache, not a source of truth — losing it costs nothing, it's regenerated identically on request.
- **OD evidence attachments** (event posters, selection letters, receipts, tickets) are needed only while a request is active. Once the HOD closes the ticket after the event review, they serve no further purpose and are automatically purged (§10.4).

### 10.2 The Numbers, Revised

8,000 students, conservatively 100 certificates each, averaging 250KB: **~200GB minimum**, permanent, growing every semester. This is now the entire long-term storage picture — OD attachments no longer accumulate indefinitely, they cycle through and get deleted.

### 10.3 Where Files Live

Self-hosted object storage (Garage) on the VPS, on an attached, independently growable volume — not the VPS's own boot disk. Encrypted backups sync to an external service (Cloudflare R2 or Backblaze B2), used purely as an offsite copy, not as live storage.

### 10.4 Attachment Lifecycle

Every category defines whether its attachments are retained after the request closes:

| Category type | Attachments after close |
|---|---|
| OD Requests (approval-mode) | **Purged automatically**, after a short grace period, once the HOD closes the ticket following event review |
| Achievement Log (log-only) | **Retained permanently** — these are the certificates themselves |

This is a per-category setting, not hardcoded — a future category could choose either behaviour.

### 10.5 Upload Pipeline

Every upload is compressed before it's kept: images stripped of EXIF, resized, re-encoded to WebP; PDFs linearized and compressed. No exceptions remain — since Parent Undertakings are no longer files, there's nothing that needs byte-for-byte preservation.

---

## 11. Analytics Dashboards (Dean & Others)

### 11.1 Separate From Approval

Dashboard access is a **distinct, admin-granted permission** — not tied to priority level or to being an approver. A Dean might approve almost nothing and spend their time entirely in the dashboard; someone could be given dashboard access with zero approval authority at all.

### 11.2 Scope

Admin decides, per person, **which departments** their dashboard access covers. A Dean overseeing several departments sees all of them; someone overseeing one sees just that one.

### 11.3 What It Shows

- Top-level counts per department per day/week/month (e.g. "Cyber Security: 13 ODs today").
- Drill-down: click the count, see which students and what each request is for.
- Breakdown by category (Tech vs Non-Tech, by subcategory), by status, and by decision mode.

---

## 12. Student Activity Panel

Wherever a student's name appears to a reviewer — on a request, in a search result — a compact summary sits alongside it:

- Request counts by category (e.g. "3 Tech · 5 Non-Tech")
- An expandable view (hover or an (i) icon) showing: past requests, achievements, wins, and notable activity

This gives reviewers context without digging — a mentor or HOD approving a request can see the student's pattern at a glance, not just the request in isolation.

---

## 13. Internal Notes & Canvas

Unchanged in principle from earlier versions:

- Every request has a comment thread with **public** (student-visible) and **internal** (staff-only, never visible to the student under any circumstance) visibility.
- A canvas — freeform notes, attached to a request or standalone — inherits the same visibility model. An internal canvas is staff-only.

---

## 14. Digital Signatures, Parent Consent & Generated Documents

### 14.1 Stored Signatures

Any staff member who needs to appear on an official document registers a signature once — drawn on a canvas or uploaded from a photo, then automatically cleaned (background removed, cropped tight) into a consistent stamp. Stored once, reused on every document that needs it going forward. No re-signing per document.

### 14.2 Parent Consent — a Verified Record, Not a Document

For an outstation OD, the Mentor calls the participating student's parent, confirms verbally, and records it: parent name, contact number, transport mode, who verified it, and when. That's the entire "Parent Undertaking" — a structured record, not a scanned form. It carries the same information the old paper version required; it just never touches paper.

### 14.3 Generated Documents (Annexure 4.4, NOC)

Both are the same pattern: a template, populated from the request's data, with the relevant people's stored signatures stamped in, rendered into a PDF the moment it's requested. A student needing an NOC for a hackathon clicks download — no staff step, no pre-printing, no waiting.

### 14.4 Verifiable, Without Being Precious About the File

The PDF itself is disposable — it can be regenerated identically at any time from the request data and the stored signatures, so losing a cached copy costs nothing. What's protected is the **underlying record**: a signature entry (who, what, when) and a hash of the exact data that was signed. Every generated document carries a reference code; anyone can look that code up and confirm it matches a real signature record, independent of whether the specific PDF file still exists anywhere.

Approval-mode decisions in the request flow itself work the same way — an approval is a signature record (§ signatures), verified by MFA at the moment of signing, hashed against the request state so post-signature tampering is detectable. Log-only reviews don't produce a signature; there's no decision being signed, just an acknowledgement.

---

## 15. Acceptance Criteria

- [ ] Setup wizard runs end to end on a fresh instance: admin created, MFA enrolled, domains configured, org configured.
- [ ] Every new user is forced through MFA enrollment before reaching any other screen.
- [ ] A Tech/Hackathon OD can be submitted, routed via the picker, forwarded via search, and approved — with Mentor and HOD present as watchers throughout regardless of route.
- [ ] An Achievement Log (online cert) can be submitted, reviewed once, and saved — with no approve/reject step anywhere in the flow.
- [ ] Internal comments are never returned to a student session — verified by an automated test.
- [ ] A Dean with access to 3 of 6 departments sees exactly those 3 in their dashboard, and no others.
- [ ] Student activity panel shows correct counts and expands to show achievements, wherever a student's name appears to a reviewer.
- [ ] A new category, a new custom field, and a new tag can all be added by Admin with no code deploy.
- [ ] Uploaded files are compressed and land in external object storage, never on the VPS disk.
- [ ] `auth.uid()`-based RLS policies correctly scope every table — proven by an automated cross-user access test suite.

---

## 16. Deferred Features

| Feature | Note |
|---|---|
| Visual workflow-graph builder | Picker + search-and-forward covers current needs. Revisit if routing needs get genuinely conditional/parallel. |
| Multi-org / multi-tenant | Single org, multiple login domains, for now. |
| Online OD for club events | Needs club events as first-class entities students register against. |
| SLA timers, auto-escalation | Schema can support due dates later; no automation yet. |
| Notification delivery | Events recorded now; email/SMS wiring later. |
