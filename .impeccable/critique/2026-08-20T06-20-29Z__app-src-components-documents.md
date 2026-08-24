---
target: the new document surfaces (TemplatesPage, DocumentView, SignaturePad, VerifyPage)
total_score: 15
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-08-20T06-20-29Z
slug: app-src-components-documents
---
Method: dual-agent (A: design review · B: detector + browser evidence)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 1 | Unlabeled bare spinner; no `aria-live` on any alert; modal title reads "Document" then changes under the user |
| 2 | Match System / Real World | 3 | Strongest area — but `annexure_4_4` is shown to users while the "Display name" they typed is never used |
| 3 | User Control and Freedom | 1 | No Escape on either modal; signature has Clear but no undo; Publish is irreversible with no confirm |
| 4 | Consistency and Standards | 1 | Five existing components reimplemented; ~18 Tailwind hexes; a third breakpoint at 720px |
| 5 | Error Prevention | 0 | Preview corrupts an undeletable draft; no publish confirm; no signature undo |
| 6 | Recognition Rather Than Recall | 1 | Raw 36-char UUID inserted mid-letter; `readableSlots()` runs only in preview; docType must be recalled exactly |
| 7 | Flexibility and Efficiency | 2 | "New version from this" is good; no autosave, no draft persistence, no unsaved-changes guard |
| 8 | Aesthetic and Minimalist Design | 2 | `.doc-sheet` reads as a page; undercut by a 7-control toolbar and 4 action locations for one task |
| 9 | Error Recovery | 1 | Render failure = red alert, Print disabled forever, no retry, no diagnosis of the two likely causes |
| 10 | Help and Documentation | 3 | Genuinely good inline help — the dash explainer, "no account needed", the `!intact` paragraph |
| **Total** | | **15/40** | **Poor — major UX work required** |

All ten heuristics apply; three of the four screens are Operate and one is Read, so the Persuade/Experience n/a exemption is not available.

## Design Specificity Verdict

**LLM assessment: not authored for this product. Generic admin-panel UI wearing the app's class names.**

The evidence is not a feeling. The surface reimplements or ignores five components the design system already ships:

| Already exists | What was built instead |
|---|---|
| `.sigstrip` / `.sigcell` / `.sigcell__mark--blank` — the authored signature strip | `.sig-name { border-top: 1px solid #111827 }` — hardcoded hex, ruled on the wrong edge |
| `.countersigned` — gold ring and wash, the system's entire gold budget | Never used. Verify success is `#f0fdf4 / #86efac / #14532d` — Tailwind green |
| `.empty-state` with its authored dashed treatment | Appears in zero of the four files |
| `.form-input--code`, documented as existing so a transposed digit is visible | The public reference-code input uses plain `.form-input` |
| `Modal.tsx` | `DocumentView` hand-rolls `.modal-overlay` / `.modal-content` |

Four referenced tokens are defined nowhere: `--accent`, `--ink-soft`, `--surface`, `--font-body`. So `.tpl-surface:focus { outline: 2px solid var(--accent, #2563eb) }` paints literal Tailwind blue-600 — and overrides the system's SRM-blue ring on the most important control on the page, on `:focus` rather than `:focus-visible`.

Radius: the scale is 2–3px, "a cut paper edge." This surface ships 6px, 8px, and **12px on `.verify-card`** — the public page, four times the system maximum. The Mono-Is-Measurement rule is broken at every measurement site here: the reference-code input, the printed reference code, `doc_type`, both dates.

**Deterministic scan: 0 findings, exit 0, raw JSON `[]`.** The three pre-approved `ignoreValues` suppressed nothing. That clean result is real but much narrower than it looks — a control file containing `#ff00ff`, `Comic Sans MS` and a `rgba(0,0,0,.5)` shadow inside a JSX `style={{}}` was also passed clean, proving `design-system-color` and `design-system-font` do not evaluate TSX inline styles at all. The detector caught nothing the review found, and could not have.

**Visual overlays: none.** Browser automation is unavailable in this session (the Chrome extension is not set up), so no injection was attempted, no live server was started, and nothing was visually observed. Fallback signal only: `/verify` and `/verify/NOSUCHCODE` both return HTTP 200 and are **byte-identical at 3269 bytes** — the not-found state is client-rendered and was not observed.

TypeScript compiles clean (`tsc --noEmit`, exit 0, re-run with `--incremental false` to defeat a stale buildinfo cache).

## Overall Impression

The thinking is better than the building. The comments in these files argue correctly about why the record is the artefact and the file is disposable — and then the code renders the record as a Tailwind alert box and gives the disposable PDF the serif treatment. Authority landed on the wrong object.

The biggest opportunity is not visual. Two defects mean the surface does not currently do its job: printing emits the whole application instead of the document, and previewing a template corrupts a draft that publishes into an append-only, undeletable table.

## What's Working

1. **The printed reference code and verify pointer.** "Reference: … / Verify at …/verify" stamped onto the sheet itself. The comment says it exactly right — a reference code that only exists on screen cannot be checked from paper. Almost nobody builds this.
2. **The honest `!intact` copy.** It refuses to overclaim: it explains that a resubmitted request reads the same way and tells the reader what to do. Most products would render "TAMPERED" in red.
3. **Client-side signature cleaning with a preview before commit** — cleaning a copy so the pad survives, and labelling it "this is what will appear on documents." Keeping the raw photo off the server is the right call.

## Priority Issues

### [P0] Printing emits the application, not the document
Nothing in `@media print` hides `.main-content` or the parent `RequestDetailModal`'s `.modal-body`. `#doc-print-area` exists as an id and nothing scopes to it. So `window.print()` from the nested document modal produces the requests table, then the request's field values, body prose and comment thread, then the letter.

**Why it matters:** this sheet is the artefact a student hands to an employer, and it carries a verification URL. It currently leaks internal ticket contents onto that document. A supporting tell that this was never actually printed: the print block hides `.app-nav`, a selector that does not exist in the DOM — AppShell renders `nav.nav-tabs`.

**Fix:** scope printing to an isolated print root rather than hiding named chrome. Verify from a real print preview opened inside the nested modal.
**Command:** `/impeccable harden`

### [P0] Previewing a template silently corrupts an undeletable draft
The template body lives only in the DOM (`editorRef.current.innerHTML`), never in React state. Both branches of the Preview ternary render a `div.tpl-surface` in the same slot, so React reuses the node. `readableSlots()` is a **one-way** substitution — `{{signature:<uuid>}}` becomes the literal prose `⟨Dean's signature⟩`, and there is no inverse anywhere in the file. "Publish version" sits outside the ternary and stays live throughout.

**Why it matters:** toggling Preview then Edit either loses the draft or leaves signature slots as prose. Publishing is append-only; a corrupted version cannot be deleted, only superseded, and any document already issued from it regenerates that way forever. This is the failure mode the append-only design exists to make safe, turned into the thing that makes it dangerous.

**Fix:** hold `bodyHtml` in React state as the single source of truth, render preview into a separate element, and disable Publish while previewing. `readableSlots` is display-only and must never round-trip.
**Command:** `/impeccable harden`

### [P1] Keyboard users cannot register a signature, and five controls have no name
`SignaturePad` wraps `<input type="file" style={{ display: 'none' }}>` in a `<label>`. `display: none` removes it from the tab order and a `<label>` is not focusable, so mouse click is the only trigger — and the alternative path is a pointer-only `<canvas>` with `onPointerDown/Move/Up/Leave` and no keyboard route. A keyboard-only mentor cannot register a signature at all. The drawn path also has no undo, only Clear.

Alongside it: the four format buttons and the modal close button are icon-only with no `aria-label` and no `aria-pressed`; the `contentEditable` div has no `role`, name, or `aria-multiline`; the two insert `<select>`s are named only by a placeholder option that is cleared on every change; no alert anywhere carries `aria-live`; and no modal has `role="dialog"`, `aria-modal`, a focus trap, or an Escape handler — with two nested overlays both at `z-index: 50`.

**Why it matters:** WCAG 2.1.1 Level A functional lockout, plus 4.1.2 and 4.1.3 failures. WCAG 2.1 AA is a binding project requirement, and this is the one screen in the surface every staff member reaches.

**Fix:** clip-rect the file input instead of `display: none` and keep it focusable; add stroke-history undo (snapshot ImageData on `pointerup`); name every icon-only control; give the editor a role and label; `role="status"` / `role="alert"` on outcomes.
**Command:** `/impeccable audit`

### [P1] Six empty states, none built, on a product that ships with no data by rule
With today's live database: 0 categories means the Category select holds one placeholder and both lower cards are gated off — three inputs and nothing else, with no route to creating a category. 0 levels means "Insert signature…" opens onto nothing. 0 binding keys means "Insert field…" suppresses both optgroups. 0 templates means the Published-versions card is silently absent, so the captain cannot tell whether none exist or the page failed. The document modal shows an unlabeled spinner while rendering, and on failure a red alert with Print permanently disabled and no retry — when the two likeliest causes (no template for this category; the approver never registered a signature) are both specific and fixable. And `/verify` tells a stranger nothing about which institution this is or what a result will mean before they type.

**Why it matters:** "No fixture data, ever" is a product rule, so every user's first encounter with this surface *is* the empty state. `.empty-state` already exists with an authored treatment and is used in none of these files. I stopped short of P0 only because the Workflow tab does give a captain a route to create a category — it is undiscoverable from here, not absent.

**Fix:** all six on `.empty-state`; gate the page on categories with a titled state pointing at Workflow; label the spinner; on render failure name the two causes and offer Retry.
**Command:** `/impeccable onboard`

### [P2] The surface speaks a different design language than the app around it
Everything in the specificity verdict: five reimplemented components, four undefined tokens, deprecated bridge tokens in brand-new code (`var(--bg-color, #f8f8f7)` on the public page; three `var(--border)` boxes in SignaturePad), 6/8/12px radii, ~18 hardcoded Tailwind hexes, a third breakpoint at 720px, `.doc-modal` at 60rem against a 46rem system modal, and 21 inline `style=` props against an explicit Don't.

**Why it matters:** `/verify` is the only screen an outside institution will ever see, and its entire job is conveying institutional authority. It currently looks like a Tailwind starter. Meanwhile `countersigned` — defined as the system's single moment of gold — is spent nowhere in the product.

**Fix:** rebuild `verify-*` on the `--state-*` tokens with `countersigned` as the intact result; retire `.sig-*` for `.sigstrip`/`.sigcell`; delete `.tpl-surface:focus`; set every code and timestamp in `--font-code`; move the inline styles into the stylesheet.
**Command:** `/impeccable polish`

## Persona Red Flags

**Sam (screen reader / keyboard) — the surface is largely unusable.** Upload photo is mouse-only and the canvas is pointer-only, so there is no keyboard route to a signature at all. The four format buttons and the modal close announce as bare "button." The editor is an unlabeled, un-roled editable region. No modal has dialog semantics, a focus trap, or Escape — and two are nested, so focus is loose across both. "Published.", "No such document." and "Signature saved." are all silent. The one win: `.verify-result` carries icon, colour *and* text, so the outcome is not colour-alone.

**Riley (stress tester) — breaks it in under a minute.** Type a template, click Preview, click Edit: the draft is gone or its signature slots are now prose — then Publish ships it into an undeletable table. Print from the document modal and hand an employer the comment thread. Paste a web page into the editor: the sanitizer unwraps rather than deletes, and the `style` allowlist lets pasted CSS restyle every document that category ever generates. Type a `docType` that already exists with different casing and get a second lineage, both `v1`. Draw one wrong stroke and the only recovery is total erasure. Paste a code with the placeholder's trailing `…` and get a generic failure with no normalisation.

**Jordan (the captain on day one) — hits a dead end immediately.** Zero categories exist. They open Templates, read an encouraging subtitle about Annexures and NOCs, and find a select containing only "Choose a category…". Nothing else renders. No empty state, no explanation, no link. The next thing asked of them is `annexure_4_4` — an exact machine string taught only by a placeholder — beside a "Display name" field whose value the request modal never actually shows, because it renders the raw `doc_type` on the launch button. And the page's one irreversible action explains its irreversibility only after it has happened.

## Minor Observations

- `.tpl-missing`, `.sig-stamp`, `.sig-pending` are emitted by SQL (`0017`/`0020`), not by any component — a CSS-to-source coupling invisible from the frontend and undocumented in the stylesheet.
- `.doc-footer` sets the printed reference code at `0.75rem` in `#4b5563` — the one string a human must transcribe off paper is the smallest, faintest thing on the sheet.
- `.verify-result` declares `border: 1px solid` with no colour; a typo'd modifier renders a black box.
- Three dead hooks: `className="page"`, `className="table"`, and `id="doc-print-area"` — the last one being the print bug's missing half.
- The verify input has no `inputMode`, `autocomplete="off"`, `spellCheck={false}`, or `maxLength`; a phone will autocorrect a reference code.
- `SignaturePad` never revokes its preview object URLs across repeated attempts.
- `listTemplates` reads `document_templates` via `.from()` in a module whose header claims the browser "never touches a table" — reads only, but the comment overstates.
- `.doc-sheet` has no `overflow-x` container, so a wide table in a template has no mobile story.
- These screens target `0017`/`0020`, which `HANDOFF.md` says have never been applied to any database. That is why nobody has met these empty states — an engineering fact, not a design finding.

## Questions to Consider

1. If the record is the artefact and the file is disposable, why does `/verify` — the record's only public face — look like a Tailwind alert box while the disposable PDF gets the serif treatment?
2. `countersigned` is the system's single moment of gold and is currently spent nowhere. If "genuine and unchanged since it was signed" is not that moment, what was the mark reserved for?
3. Why a WYSIWYG at all? The system's own vocabulary — `.sigstrip`, `.detail-row`, `.stub`, the field/label/rule grammar — is a *structured* document model. A block composer over that grammar would eliminate the contenteditable accessibility problem, the paste-sanitisation problem, the raw-UUID problem and the preview-corruption problem at once. The rich-text editor is the direct cause of four of the five issues above.
4. `--accent`, `--ink-soft`, `--surface` and `--font-body` were typed into new CSS while being defined nowhere. What enforces the design system? A lint rule failing the build on undefined custom properties and on hex literals outside `index.css` would have caught most of this before review.
5. Registering a signature binds a person's mark to every future approval, and every decision already requires `aal2`. Should it sit at the bottom of AccountPage under "Change password", with no re-prompt and no ceremony?
