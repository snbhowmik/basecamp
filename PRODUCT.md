# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two populations, same platform, different jobs:

- **Students** — submit requests (On-Duty/OD for tech and non-tech events, achievement/certificate logs), track their status, complete a first-boot MFA enrollment, and view their own request/achievement history. Primarily mobile: they act on this between classes, from a phone.
- **Staff, in an ordered hierarchy** (Captain → Dean → HOD → Mentor, plus role-tagged people like coordinators and Student Outreach Faculty) — review, approve/reject, forward, or log-review requests; create accounts for the level(s) below them; some hold analytics-dashboard access independent of approval authority. Primarily desktop: this is a work tool used at a desk.

First deployment is SRM Institute of Science & Technology, Trichy campus (SRMIST), sized for 8,000+ students, but the platform is built to be instantiable for any organisation via its own setup-wizard run — OD is the first configured use, not something hardcoded into the product.

## Product Purpose

A self-hosted, generic request/ticketing platform. It exists to replace a paper-and-spreadsheet OD (On-Duty) approval process with a configurable digital one: requests that need a real decision (approve/reject/send-back) and requests that just need logging (reviewed once, no gate), routed through an admin-configurable hierarchy rather than a hardcoded role list.

Success = a request category (starting with OD) can be submitted, routed, and resolved end-to-end with a full audit trail, MFA-backed signatures on every decision, and zero fixture/seed data in a real deployment — every account and org structure is created by a verified human at the appropriate level.

## Positioning

Not a generic form builder and not a commercial helpdesk (Zoho/Freshdesk) repurposed for a university. Its distinguishing mechanism: **priority levels + free-form tags, not a fixed role enum**, so "who can approve what" is org-configured data, not code — an org can insert, rename, or reorder levels without a deploy. Combined with self-hosted Supabase, this gives real `auth.uid()`-enforced Row Level Security as the authorization boundary, not a hand-rolled auth layer, while keeping every account manually created and verified (no seeded fixture data, ever, in a real deployment).

## Operating Context

- **Students**: mobile-first. Submitting an OD request, checking status, and uploading a certificate happen on a phone, often between classes.
- **Staff (Mentor/HOD/Dean/Captain)**: desktop-first. Reviewing, approving, forwarding, and running dashboards happens at a desk.
- First-boot setup wizard: captain account creation, mandatory TOTP MFA enrollment, allowed-domain configuration, initial org bootstrap (priority levels, first request category). Nothing else in the app is reachable until this completes.
- Ongoing account creation cascades by hand: Captain creates Deans/top-of-chain; Dean creates HODs; HOD creates Mentors and Students for their department. No bulk import, no fixture data.
- Outstation OD requests trigger an Annexure 4.4 form flow (generated PDF, on demand, from data + stored signature) and a verified parent-consent record (a mentor's phone call, logged — never a scanned document).
- Every sensitive action (approval, viewing internal notes, admin operations) requires a completed-MFA (`aal2`) session, enforced at the database level.

## Capabilities and Constraints

- **Two decision modes per request category**: `approval` (needs approve/reject/send-back) and `log_only` (reviewed once, saved, no reject state). Configured per category, not hardcoded per request type.
- **Routing**: a configurable picker of suggested first-hop recipients per category, then free search-and-forward to anyone in the system by name/tag, fully logged. Student's Mentor and department HOD are always added as watchers on submission, regardless of actual routing — they see the ticket but aren't blockers.
- **Storage**: only student-uploaded certificates/achievements need permanent storage (self-hosted Garage/S3-compatible, on a separately attached volume, encrypted offsite backup — not the VPS boot disk). OD evidence attachments auto-purge a week after ticket close. Generated PDFs (Annexure 4.4, NOC) are a disposable cache, regenerable identically from DB data + stored signature at any time.
- **Signatures**: staff register a signature once (drawn/uploaded, auto-cleaned), reused on every generated document. Every signed record is hashed against the data it signed, independently verifiable by a reference code — the PDF file itself is not the source of truth.
- **Analytics dashboards**: a distinct, admin-granted permission, scoped per person to specific departments — not tied to approval authority or priority level.
- **Currently built**: schema, RLS/authorization model, routing/watcher/purge triggers, domain-restricted signup guard, Docker Compose stack, frontend scaffold, first-boot setup wizard, public student self-registration, staff invite links. Verified against a real running deployment (self-hosted VPS, Cloudflare Tunnel, Mailcow SMTP, Garage), not just reviewed as code.
- **Not yet built**: the request submission/approval flow's full UI, cascading account-creation UI beyond the wizard, the PDF generation service, the signature-cleaning image pipeline, the scheduled Garage-purge job, offsite backup sync automation.
- **V2 design (not yet built, see PRD-V2.md)**: multi-role-at-once via explicit "acting as" context switch; four-level org structure (faculty → programme → batch → section) replacing flat departments/classes; per-category level participation (`approves`/`notified`/`skipped`); register-number-based identity search and signup validation; person cards (Tier 1 public, Tier 2 privileged) with mentor-verified CGPA.
- **Explicit non-goals (v1)**: visual workflow-graph builder, multi-tenant deployment, SLA timers/auto-escalation, actual notification delivery (events are recorded, delivery is stubbed), online OD auto-registration for club events.
- **Accessibility standard**: WCAG 2.1 AA is the binding requirement for all UI work.

## Brand Commitments

Product name: **SRMIST BaseCamp** (rebranded from an earlier internal "Basecamp" working name — a real trademark consideration if ever distributed publicly under that name, not a concern for this internal deployment). No other binding visual identity constraints from the institution have been recorded; the current visual system (indigo primary, dark top bar, service-desk-console layout) is incumbent implementation, not yet documented as an approved DESIGN.md.

## Evidence on Hand

No testimonials, case studies, or external press exist or should be fabricated. Real data on hand is architectural/operational: `ARCH.md` (schema and data design), `NOTE.md` (dated incident/decision log), `TASK.md` (build tracker), `SECURITY.md` (threat model), `DEPLOY.md` (deployment runbook) — all at the repo root, and authoritative over any planning document when they disagree.

## Product Principles

1. **Configuration over code.** Priority levels, tags, departments, categories, custom fields, and routing must stay admin-editable data — this is a ticketing platform that happens to be configured for OD, not an OD tool.
2. **No fixture data, ever.** Every account and org structure in a real deployment is created and verified by hand by a human at the correct level. Seed/demo data exists only for throwaway local instances.
3. **RLS is the real boundary.** Authorization is enforced in Postgres via `auth.uid()`-based Row Level Security and shared `security definer` helper functions — never a frontend-only check, never a hand-rolled auth layer.
4. **Disposable files, durable records.** Only certificates/achievements are permanently precious. Generated PDFs, evidence attachments, and even approval signatures on documents are regenerable or independently verifiable from underlying data — losing the file is not losing the record.
5. **Verify against the real system.** Decisions get proven against a running stack (real `docker compose`, real curl, real browser), not just reasoned about from what code should do — this project has repeatedly found infrastructure bugs that only appeared once actually run.

## Accessibility & Inclusion

WCAG 2.1 AA is the binding standard for all UI work on this project.
