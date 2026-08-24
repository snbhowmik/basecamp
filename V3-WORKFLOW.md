# V3 — Workflow, participation, and printable documents

**Written:** 2026-08-25 · **Status:** design, nothing applied
**Schema home:** `supabase/schema-v2/0026+` — *not* a new `schema-v3/` directory.
`basecamp_meta.schema_migrations` keys on filename and `apply-migrations.sh`
reads one directory. "V3" is the product version, not the schema directory.

---

## 1. The headline: most of this already exists

Before designing anything I read `0002_requests.sql` against your description.
Ten of the fourteen things you asked for are already tables. This is the
difference between two new tables and eight.

| What you asked for | Where it already lives |
|---|---|
| "each Request has a name" | `request_types.name`, `request_categories.name` (self-referencing tree, unbounded depth) |
| "how many people should be involved and in which order" | `category_level_roles` — `participation` (`approves` / `notified` / `skipped`) + `sort_order` |
| "requires a parent permission or not" | `level_checks.check_type = 'all_participants_consented'`, `scope = 'per_participant'`, plus the `request_participants.parent_consent_verified*` columns |
| "requires additional clauses" | `level_checks` — `manual`, `field_present`, per-category or all-categories |
| "include the names or reg number of another student in a request" | `request_participants` with `snapshot_name` / `snapshot_reg_no` |
| "and the other student may also accept it" | `request_participants.acceptance_status` (`pending`/`accepted`/`declined`) + `accepted_at`. Already built, exactly as you described it. |
| "more than one club_administrator … at the same time" | `unique (request_id, member_id)` already dedups two admins adding the same student |
| "the sign of all the people required" | `signatures` — append-only by trigger, carries `level_id`, `acted_as`, `state_hash` |
| "the pdf is always generated and never stored" | `generated_documents` already treats `cached_object_key` as disposable. "Never stored" = never write that column. It is one line. |
| "created only through the dashboard and not baked in" | `request_types`, `request_categories`, `field_definitions`, `category_level_roles` are all data already |

**So the honest scope of V3 is five things, not fourteen.**

---

## 2. What is genuinely new

### 2.1 Who may *file* — the one missing table

You said "clauses (who can request from which roles)". I grepped for it:
there is `category_first_hop_options`, but that is who **receives** a request
first, not who may **raise** one. Nothing gates initiation today — any member
can file against any active category.

Proposed, in `0026`:

```sql
create table category_initiators (
  category_id uuid not null references request_categories(id) on delete cascade,
  tag_id      uuid not null references tags(id),
  primary key (category_id, tag_id)
);
```

Semantics, deliberately chosen to avoid a breaking change:

* **A category with no rows is open to everyone.** That is today's behaviour,
  so every existing category keeps working and nobody has to go and configure
  100 categories before the feature ships.
* A category with rows is restricted to holders of those tags.
* Enforced in `create_and_submit_request()` (`0004`, line 361) and mirrored in
  the category picker so the UI doesn't offer what the server will refuse.

This is where "a student_club_administrator may apply for an event ticket"
lands — **by tag, not by a hardcoded role name.** You said "not baked in"
twice and this is the place that rule gets tested.

### 2.2 The participant window

> "when it gets approved by the HOD and mentor … the club administrator gets a
> window to add the OD participants"

Today participants are added before submission. You want a category to be able
to say: *approve the event first, then collect the names.* That is a per-category
flag plus a state, not a new workflow engine.

```sql
alter table request_categories
  add column participant_phase text not null default 'before_submit'
    check (participant_phase in ('before_submit', 'after_approval'));

alter table requests
  add column participants_open_until timestamptz;
```

* `before_submit` — today's behaviour, unchanged.
* `after_approval` — participants are refused before the request reaches
  `approved`; on approval, `participants_open_until` is set and the club
  administrators may add people until it lapses.

The window closes on a timestamp rather than a status so it can outlive the
approval and does not need a scheduler. Who may add during the window =
`category_initiators` again, so two club administrators both hold the tag and
both can add students concurrently. This is also the **pre/post field phase
flag** you asked for earlier, generalised — the same column can gate
`field_definitions` if you want fields collected after approval too.

### 2.3 Scan to add

"a scan option" — the club admin scans a student ID and the student is added.

This needs no new table. A scan produces a register number; the flow is
`add_participant_by_reg_no(p_request_id, p_reg_no)`, one RPC, which resolves
`member_profiles.reg_no` → `profiles.id`, snapshots name and reg number, and
inserts with `acceptance_status = 'pending'`. The student then accepts in
their own inbox — the scan adds them, it does not consent for them.

Frontend: `BarcodeDetector` where the browser has it (Chrome/Android does),
manual reg-no entry as the fallback everywhere else. No library, no camera
upload, nothing leaves the device but the reg number.

### 2.4 The print gate

> "after that's done generate the pdf and show"

A `can_print(request_id, doc_type)` predicate: every `category_level_roles`
row with `participation = 'approves'` has a matching `signatures` row with
`decision = 'approved'`, **and** every required `level_checks` row has a
`passed` result. Levels with no holder in scope count as satisfied — that is
already the documented rule for `category_level_roles` and reusing it keeps
one definition of "skipped".

`render_document()` (`0020`) already refuses when you cannot see the request;
this adds the completeness half.

### 2.5 pdfme

`https://github.com/pdfme/pdfme` — client-side generation, server-supplied
signatures, nothing stored. That works with what exists, with one correction
to how you described it:

**The server does not "put the approval sign" into the PDF.** `render_document()`
returns HTML plus `signature_keys`; the browser fetches those objects from
storage and pdfme lays them out. The gate is `can_read_signature()` (`0018`),
which is already scoped — you may fetch a stamp only if you can see a request
that person signed.

One weakness I want to flag rather than paper over: that check is
*"a request they signed"*, not *"this request"*. So someone who can legitimately
see one signed request can fetch that signer's stamp while rendering a
different one. In practice the object key is unguessable and the set is the
same people, so this is not urgent — but it is looser than the comment above
it claims, and `0026` is a cheap place to tighten it to the specific request.

Client-side rendering does **not** weaken verification, and I want to be clear
about why, because it looks like it should. `signatures.state_hash` and
`generated_documents.state_hash`/`reference_code` are computed server-side from
the row. `/verify/<code>` recomputes from the row. The PDF is a *rendering of
the record, not the record* — a forged PDF carries no code that resolves.

---

## 3. Save / Cancel — and the reason you gave for it

> "always have a save and or cancel changes … that way we call lesser
> concurrent connections"

Agreed, with one thing that has to be designed in from the start rather than
retrofitted: **a Save button that then fires twelve `rpc()` calls in a loop has
the button and none of the benefit.**

So each editor's Save is **one RPC taking the whole changed set** as a jsonb
array, diffed server-side inside one transaction:

```sql
save_category_routing(p_category_id uuid, p_rows jsonb)   -- replaces category_level_roles
save_category_checks(p_category_id uuid, p_rows jsonb)    -- replaces level_checks
save_category_fields(p_category_id uuid, p_rows jsonb)    -- replaces field_definitions
save_category_initiators(p_category_id uuid, p_tags uuid[])
```

Each is `security definer`, `set search_path = public`, captain-gated. On the
frontend a `useDirty` hook holds a draft copy, enables Save/Cancel when it
diverges, and warns on navigate-away. Existing single-shot RPCs
(`create_first_hop_option` etc.) stay for the create-one-thing forms.

**Note on `0024`:** every function in `0026` carries `security definer` and
`set search_path = public` explicitly, including any later `create or replace`.
That omission is exactly what took the site down on the 23rd.

---

## 4. Stages and tasks — the correction

§1 above listed `level_checks` as "already exists". That understated the
problem, and the captain's "the options are baked in" was right in a way the
table did not show.

`level_checks` has existed since `0002` and has **never had a write RPC or a
line of UI**. `RoutingEditor` edits `category_first_hop_options` and nothing
else. Structurally present, unauthorable in practice — which from the
captain's chair is indistinguishable from hardcoded. And `check_type` is one
of three fixed strings, so even with a UI nobody could have written "parent
permission taken [yes/no]"; they could only pick from a menu the schema chose
in advance.

Worse: **`category_level_roles.participation = 'approves'` is read by
nothing.** `add_configured_watchers()` filters on `'notified'`;
`required_checks_outstanding()` keys on `requests.current_level_id`. There was
no stage sequence in the runtime at all — a request advanced because a holder
called `forward_request()` and named a person, and `sort_order` on that table
was decorative.

So stages are a **new advancement mechanism**, not a config table. The model
built, in the captain's own words: a category has stages; each stage is checked
by one role; each stage has one or more tasks; when the tasks are filled the
stage is done.

`category_stages` is its own table rather than reusing the (category, level)
pair, because that pair is primary-keyed on both columns and so structurally
forbids two stages held by the same role — "mentor verifies, HOD reviews,
mentor countersigns" would be unrepresentable. Nothing is lost by not reusing
it, since the `'approves'` half was dead code. `category_level_roles` stays as
it is for its `'notified'` rows.

**The actor dimension is the part that would have shipped broken.** The
captain's own example has two actors in one stage: the mentor ticks parent
permission, the *student* submits proof of selection. But
`request_check_results`' insert policy demands `holds_kind('academic')` **and**
being the current holder — a student is neither, and a club coordinator
(`role_kind = 'club'`) fails the first test too. So `stage_tasks.actor` is
`stage_role` / `requester` / `any_participant`, and `record_task_result()`
enforces it as an RPC rather than by widening that policy.

`result` and `answer` are split deliberately: `result` stays "did this task
clear" and is what the gate counts; `answer` carries what was chosen.
`passing_answers` defines the mapping — "parent permission taken" has
`["yes"]`, so answering *no* records the answer and does **not** clear the
stage.

### The template layer, resolved

The separate template-under-category table is **not built**, and the
clarification is why: stages and tasks are what "each application template has
stages" meant. A category with an ordered stage list, each stage with its own
tasks and its own checking role, *is* the template. A parallel table would
duplicate it.

## 6. What was built, and what is left

Applied as three migrations, dry-run against the live database inside a
rolled-back transaction and verified end to end before commit.

| File | Contents |
|---|---|
| `0026_stages_and_tasks.sql` | `category_stages`, `stage_tasks`, `category_initiators`; `task_id` + `answer` on `request_check_results`; `participant_phase` / `participant_window_days` on categories; `current_stage_id` / `participants_open_until` on requests; RLS written by hand (0003 and 0009 build policies from literal arrays, so a new table lands with none) and 0003's RLS assertion repeated |
| `0027_stage_lifecycle.sql` | `save_category_stages`, `save_stage_tasks`, `save_category_initiators` (one RPC per Save), `category_workflow` (one read for the whole editor), `may_file_category`, `resolve_stage_holder`, `stage_tasks_outstanding`, `advance_stage`, `record_task_result`, `add_participant_by_reg_no`, `can_print` |
| `0028_stage_gates.sql` | `create_and_submit_request`, `forward_request`, `decide_request` replaced — each is the existing body with the stage handling added |

Verified in the dry run: stage authoring round-trips through
`category_workflow`; a `choice` task with no options is refused; removing a
stage that has recorded answers is refused rather than cascading; an
unconfigured category is open to everyone and a configured one refuses a
stranger; a submitted request lands on the first stage that has a holder and
skips one that does not; a student cannot answer a `stage_role` task;
approving with a task outstanding is blocked; answering *no* records `failed`
and does not clear it; the HOD's approval advances to the Dean rather than
closing; the Dean's approval closes it with two signatures and `can_print`
true; the participant window opens for the configured number of days; scanning
the same student twice is idempotent; an unknown register number is refused.

One bug the end-to-end run caught: `can_print` demanded a signature per stage
regardless of decision mode, so a `log_only` category — which writes no
signature by design — could never have been printed. Fixed before commit.

Not built yet, and unchanged from the plan: the Workflow page editors, the
request-detail participants panel and scan window, and pdfme.

## 7. Order of work

1. `0026` — `category_initiators`, `participant_phase`, `participants_open_until`,
   the four `save_*` RPCs, `add_participant_by_reg_no`, `can_print`.
2. Workflow page — the four editors, each with Save/Cancel over one RPC.
3. Request detail — participants panel, accept/decline, the scan window.
4. pdfme — replace the print path, gated on `can_print`.

Steps 2–4 are frontend only. Step 1 is the only thing that touches the live
database, and per §3 it is additive: every default preserves current behaviour.
