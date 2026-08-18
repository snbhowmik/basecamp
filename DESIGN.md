---
name: SRMIST BaseCamp
description: An approval is a countersigned document — ruled institutional stationery for a request and approval platform.
colors:
  srm-blue: "#154494"
  srm-blue-deep: "#0f3370"
  srm-blue-wash: "#eef2fa"
  srm-gold: "#c89d00"
  srm-gold-wash: "#fdf8e7"
  paper: "#ffffff"
  paper-laid: "#faf9f6"
  paper-sunk: "#f2f1ed"
  ink: "#16161a"
  ink-body: "#3c3d44"
  ink-label: "#6a6c75"
  ink-faint: "#94969e"
  rule: "#e2e0da"
  rule-strong: "#cdcac2"
  rule-ink: "#16161a"
  state-draft: "#6a6c75"
  state-pending: "#8a5a00"
  state-pending-wash: "#fdf6e9"
  state-approved: "#1c6b47"
  state-approved-wash: "#eef6f1"
  state-rejected: "#a3271c"
  state-rejected-wash: "#fbefee"
typography:
  masthead:
    fontFamily: "Source Serif 4, Georgia, serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Source Serif 4, Georgia, serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "'cv05' 1, 'ss01' 1, 'tnum' 1"
  body-small:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.55
  code:
    fontFamily: "ui-monospace, SF Mono, Cascadia Mono, Roboto Mono, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    letterSpacing: "0.02em"
    fontFeature: "tabular-nums"
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.09em"
rounded:
  cut: "2px"
  cut-lg: "3px"
  pill: "99px"
spacing:
  sp-1: "0.25rem"
  sp-2: "0.5rem"
  sp-3: "0.75rem"
  sp-4: "1rem"
  sp-5: "1.5rem"
  sp-6: "2rem"
  sp-7: "3rem"
components:
  button-primary:
    backgroundColor: "{colors.srm-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.cut}"
    padding: "0.5rem 0.9rem"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.srm-blue-deep}"
    textColor: "#ffffff"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.cut}"
    padding: "0.5rem 0.9rem"
  button-secondary-hover:
    backgroundColor: "{colors.paper-sunk}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-label}"
    rounded: "{rounded.cut}"
    padding: "0.5rem 0.9rem"
  button-ghost-hover:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.state-rejected}"
    rounded: "{rounded.cut}"
    padding: "0.5rem 0.9rem"
  button-danger-hover:
    backgroundColor: "{colors.state-rejected-wash}"
  button-success:
    backgroundColor: "{colors.state-approved}"
    textColor: "#ffffff"
    rounded: "{rounded.cut}"
    padding: "0.5rem 0.9rem"
  button-sm:
    padding: "0.3rem 0.6rem"
    typography: "{typography.body-small}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.cut}"
    padding: "0.5rem 0.65rem"
    typography: "{typography.body}"
    width: "100%"
  input-disabled:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink-faint}"
  sheet:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.cut-lg}"
    padding: "1.5rem"
  field:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "0.75rem 0"
  field-label:
    textColor: "{colors.ink-label}"
    typography: "{typography.label}"
  stub:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "0.75rem 1rem"
    width: "100%"
  stub-hover:
    backgroundColor: "{colors.paper-sunk}"
  mark-draft:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.state-draft}"
    rounded: "{rounded.cut}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.label}"
  mark-pending:
    backgroundColor: "{colors.state-pending-wash}"
    textColor: "{colors.state-pending}"
    rounded: "{rounded.cut}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.label}"
  mark-approved:
    backgroundColor: "{colors.state-approved-wash}"
    textColor: "{colors.state-approved}"
    rounded: "{rounded.cut}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.label}"
  mark-rejected:
    backgroundColor: "{colors.state-rejected-wash}"
    textColor: "{colors.state-rejected}"
    rounded: "{rounded.cut}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.label}"
  countersigned:
    backgroundColor: "{colors.srm-gold-wash}"
    textColor: "#6f5700"
    rounded: "{rounded.cut}"
    padding: "0.25rem 0.75rem"
    typography: "{typography.body-small}"
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-body}"
    rounded: "{rounded.cut}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.code}"
  nav-tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-label}"
    padding: "0.75rem"
    typography: "{typography.body}"
  nav-tab-active:
    backgroundColor: "transparent"
    textColor: "{colors.srm-blue}"
  avatar:
    backgroundColor: "{colors.srm-blue}"
    textColor: "#ffffff"
    rounded: "50%"
    size: "1.75rem"
---

# Design System: SRMIST BaseCamp

## Overview

**Creative North Star: "The Countersigned Slip"**

BaseCamp is a book of institutional slips, not a ticket console. Every approval is a document with named fields, a reference code, and a signature strip that fills as authority is added. Structure comes from ruled lines, the way it does on real form stock — the hairline rule under a field, the heavy rule under a masthead, the dashed rule under a signature nobody has given yet. Nothing floats. Nothing glows. The surface is warm white form stock carrying ink neutrals, and colour arrives only when it has a job: institution blue where a control acts, seal gold once, on the countersigned state.

The system is dense but never crowded, because density is handled the way a book of slips handles it — with counterfoil stubs. A queue is a run of perforated stubs, each one a reference code, a title, and a state mark; opening one unfolds the whole slip. This is what lets the app hold hundreds of requests without pretending forty paper forms fit on a screen, and it is why the card-list-with-pill pattern is absent by construction rather than by taste.

Two anti-references are confirmed and binding: the SaaS ticket console (grey card list plus coloured status pill) and the friendly-campus-app pastel alternative. Both are refused. Desktop reads as a workspace — the open book, wide margins, many stubs visible at once. Mobile reads as a fast route — one slip, full bleed, controls grown to a thumb-sized 2.75rem while type stays exactly where it is.

**Key Characteristics:**
- Rules, not borders: hairlines and heavy rules carry all structure
- Small-caps field labels (0.6875rem, 0.09em tracking) ruled above their values
- Monospaced reference codes, register numbers, timestamps, and figures
- Ink-on-paper neutrals; blue only on acting controls; gold exactly once
- 2–3px radius — a cut paper edge, not a rounded scale
- Counterfoil stubs instead of cards for density
- One authored motion moment: a slip settling onto a desk

## Colors

An ink-on-warm-paper neutral field, sampled institution blue for action, and a seal gold spent exactly once.

### Primary
- **SRM Wordmark Blue** (`{colors.srm-blue}`): pixel-sampled from the institution's own logo. It appears only where a control acts or a place is current: primary buttons, the active nav tab and its 2px underline, focus rings and the input focus glow, the wizard's completed step ticks, the active timeline dot, the avatar disc, links, the auth side panel ground, and the caret. Never as decoration, never as a background wash behind content.
- **Blue Deep** (`{colors.srm-blue-deep}`): the hover shade of the primary button and of hovered links. No other role.
- **Blue Wash** (`{colors.srm-blue-wash}`): the 3px focus glow on text inputs, and nothing else.

### Secondary
- **Seal Gold** (`{colors.srm-gold}`) and **Gold Wash** (`{colors.srm-gold-wash}`): the ring and ground of the `countersigned` mark, with a darkened gold ink (`#6f5700`) for its text. This is the entire gold budget of the system.

### Tertiary
Four document states, each a paired ink and wash: **Draft** (`{colors.state-draft}`), **Pending Amber** (`{colors.state-pending}`), **Approved Green** (`{colors.state-approved}`), **Rejected Red** (`{colors.state-rejected}`). The ink carries the state; the wash is support. Rejected red doubles as the destructive-action colour (outlined buttons, dangerous menu items); approved green is the only other filled button in the system, used to confirm a decision.

### Neutral
- **Paper** (`{colors.paper}`): sheets, cards, modals, inputs, the letterhead topbar. The thing printed on.
- **Laid Paper** (`{colors.paper-laid}`): the app ground and the auth/wizard ground — faintly warm, like form stock rather than a grey dashboard canvas. Also the hover tint on ledger rows.
- **Sunk Paper** (`{colors.paper-sunk}`): recessed wells — table headers, stub and menu-item hover, disabled inputs, the draft mark's ground.
- **Ink** (`{colors.ink}`): headings, field values, the emphasised cell. The darkest thing on the page.
- **Body Ink** (`{colors.ink-body}`): running text and table cells.
- **Label Ink** (`{colors.ink-label}`): small-caps labels, reference codes, meta, subtitles, ghost-button rest state.
- **Faint Ink** (`{colors.ink-faint}`): placeholders, empty-state icons, scrollbar thumb hover.
- **Rule** (`{colors.rule}`), **Rule Strong** (`{colors.rule-strong}`), **Rule Ink** (`{colors.rule-ink}`): the three-weight ruling vocabulary. Hairline between fields and table rows; strong for input strokes, the signature strip's head, dashed blanks, chip and dropdown outlines, and the perforation; ink for the heavy rule under any masthead, card header, modal header, or table head.

### Named Rules
**The Single Seal Rule.** Seal gold appears exactly once in the product, on `countersigned`. The moment it decorates a heading, a highlight, or a second badge, it stops meaning "verified" and the rule is broken.

**The Acting-Control Rule.** SRM blue marks something that acts or something that is current. If an element neither performs an action nor indicates the user's present position, it is ink and rule, not blue.

**The Ink-First State Rule.** A state is legible in text and rule weight before colour is applied. Every state mark carries an uppercase word and a 5px dot in `currentColor`; the wash is never the whole signal.

### Deprecated
`--bg-color`, `--surface-alt`, `--border`, `--primary`, `--primary-light`, `--text-main`, `--text-muted` are a marked **migration bridge** aliasing the retired indigo system's names onto slip-world values so that remaining inline styles render correctly. They are transitional, not part of the system. Do not reference them in new work; they are deleted when no `.tsx` references remain.

## Typography

**Masthead Font:** Source Serif 4 (with Georgia, serif) — document titles only
**Body / UI Font:** Inter (with the system sans stack)
**Code Font:** ui-monospace / SF Mono (with Cascadia Mono, Roboto Mono)

**Character:** A transitional serif chosen to sit with the SRM wordmark handles the document's name; everything a person reads or operates is Inter; everything that is measurement — reference codes, register numbers, timestamps, counts — is monospaced. Body text runs with slashed zero and tabular figures enabled globally (`cv05`, `ss01`, `tnum`) so a transposed digit in a register number is visible.

### Hierarchy
- **Masthead** (Source Serif 4, 600, 1.75rem, 1.2, -0.02em): the document title — page headers, the letterhead title, the auth panel headline. Drops to 1.5rem below 48rem.
- **Headline** (Source Serif 4, 600, 1.375rem): modal titles and the auth card title. Drops to 1.25rem below 48rem.
- **Title** (Inter, 600, 1.0625rem): card and section headers and the brand lockup wordmark. The signature mark inside a filled signature cell uses this size in the serif.
- **Body** (Inter, 400, 0.9375rem, 1.55): all running text, inputs, buttons, table cells, nav tabs.
- **Body Small** (Inter, 400, 0.8125rem): hints, errors, dropdown meta, small buttons.
- **Code** (mono, 0.8125rem, 0.02em, tabular): reference codes, register numbers, timestamps, chips, and numeric table cells. The register figure in a stat reading is the one place mono runs large, at the 1.75rem masthead size.
- **Label** (Inter, 600, 0.6875rem, 0.09em, uppercase): the small-caps field label. This is a real ramp step, not drift: it is the size of every field label, form label, section title, table header, stat label, and signature attribution. State marks use the same size at 0.07em; the brand sub-lockup uses it at 0.12em.

### Named Rules
**The Serif-For-Documents Rule.** Source Serif 4 names documents and nothing else — mastheads, page titles, modal and auth titles, and the signature mark. It never sets body copy, labels, or controls.

**The Mono-Is-Measurement Rule.** Monospace means data you might have to check character by character: reference codes, register numbers, timestamps, counts. It is never a "technical" costume on prose.

**The Label-Over-Value Rule.** A field is a 0.6875rem uppercase label ruled above its value, never a label beside its value and never a placeholder standing in for a label.

## Layout

The page measure is 76rem, centred, with `2rem / 1.5rem / 3rem` padding. The letterhead topbar is sticky and full-bleed but holds its contents to the same 76rem measure via `padding-inline: max(1.5rem, (100% - 76rem) / 2)` — the rule crosses the whole viewport while the brand, nav, and user align with the page below.

Spacing is a seven-step scale from `0.25rem` to `3rem`. Field and detail grids are `repeat(auto-fit, minmax(13rem, 1fr))` with column gap only (`0 2rem`) — rows are separated by their own bottom rule, never by gap. Stat readings use `minmax(9rem, 1fr)` with the same column-gap-only rhythm under a heavy top rule. Two-column form grids use `minmax(14rem, 1fr)` with a full `1rem` gap.

**Breakpoints.** Two, both authored. `min-width: 60rem` splits the auth screen into the blue side panel plus form. `max-width: 48rem` performs the character shift: masthead sizes shrink, field and detail grids collapse to a single column with zero gap so the slip reads as one continuous run, stat readings go to a fixed two columns, ledger table heads disappear (the same data reads as stubs), the masthead stacks, and sheets go edge-to-edge with a negative inline margin and no radius. Interactive controls grow to a `2.75rem` minimum target — type does not change size. WCAG 2.1 AA is binding on this project.

### Named Rules
**The Full-Bleed Rule, Held Measure Rule.** Structural rules cross the full viewport; content stays on the 76rem measure. Never let a band-separating rule stop at the content edge.

**The Rule-Not-Gap Rule.** Rows in a field grid are separated by a 1px rule, not by vertical gap. Column gap only.

## Elevation & Depth

The system is flat by construction. Depth comes from ruling and tonal paper — `paper` sits on `paper-laid`, wells are `paper-sunk` — not from shadow. Only three things in the product cast a shadow, and all are genuinely lifted off the page: the account dropdown and the modal (overlay lift), and the standalone setup-wizard card (lift). Both shadow tokens carry a real vertical offset plus blur; a zero-offset halo is decoration and is not part of this system. The modal scrim is `rgba(22,22,26,0.42)` with a 2px backdrop blur.

### Shadow Vocabulary
- **Lift** (`box-shadow: 0 1px 2px rgba(22,22,26,0.06), 0 4px 12px rgba(22,22,26,0.05)`): the setup wizard card, the one standing sheet in an otherwise empty viewport.
- **Overlay Lift** (`box-shadow: 0 8px 16px rgba(22,22,26,0.1), 0 24px 48px rgba(22,22,26,0.14)`): modals and the account dropdown — surfaces that are actually above the page.

### Motion
One authored moment: **`slip-settle`** (320ms, `cubic-bezier(0.16, 1, 0.3, 1)`) — opacity in from `translateY(-6px) rotate(-0.35deg)`, a slip settling onto a desk. It is reused by the modal at 260ms, paired with a 160ms scrim fade. Everything else is a 140ms colour/border transition on hover and focus. The reduced-motion query collapses all animation and transition to 0.01ms.

### Named Rules
**The Two-Shadow Rule.** Shadows exist only for surfaces that are literally above the page: modals, dropdowns, and the standalone wizard card. Sheets, cards, stubs, stat readings, and inputs are flat.

**The One Settle Rule.** `slip-settle` is the system's only authored entrance. It plays when a slip or modal arrives. It is not a per-section reveal, and it is never chained down a list.

## Shapes

Radius is 2px on controls, marks, chips, and small surfaces, and 3px on sheets, cards, modals, and dropdowns. That is the whole scale: it reads as a cut paper edge, not as a rounded style. Full-round (`50%`) is reserved for genuinely circular objects — the avatar, the state-mark dot, the timeline dot, the spinner — and `99px` for the scrollbar thumb and the wizard's 3px step ticks. Below 48rem, sheets drop their radius and side borders entirely and run edge to edge.

Borders are ruled lines with three weights and two styles. A 1px `rule` hairline separates fields and table rows. A 1px `rule-strong` gives input strokes, the signature strip's head, chip and dropdown outlines, and the stub perforation. A 2px `rule-ink` sits under every masthead, card header, modal header, wizard step bar, and table head — that heavy rule is what says "everything below this is the document body." Dashed `rule-strong` marks a blank: an unsigned signature cell and an empty state are both a dashed edge waiting to be filled.

The recurring silhouette is the perforation: a 3px column of `repeating-linear-gradient(to bottom, rule-strong 0 3px, transparent 3px 7px)` on the leading edge of every stub, the mark of a counterfoil torn from the book.

## Components

### Buttons
- **Shape:** cut edge (2px), `0.5rem 0.9rem` padding, 500 weight at body size, 140ms colour transition.
- **Primary:** solid SRM blue on white. Hover deepens to blue-deep. This is the product's principal filled control.
- **Secondary:** white sheet with a `rule-strong` stroke and ink text; hover fills `paper-sunk` and darkens the stroke to `ink-faint`.
- **Ghost:** transparent with label ink; hover fills `paper-sunk` and darkens to ink.
- **Danger:** white with a rejected-red stroke and red text; hover fills the rejected wash. Destructive actions are outlined, never filled red.
- **Success:** solid approved-green, used only to confirm an approval decision.
- **Small:** `0.3rem 0.6rem` at 0.8125rem.
- **Disabled:** 0.45 opacity, `not-allowed`.
- **Icon button:** 2rem square, transparent, label ink; hover fills `paper-sunk`, with a red-on-rejected-wash danger variant. Below 48rem all controls grow to a 2.75rem minimum height (small buttons to 2.25rem).

### Inputs / Fields
- **Style:** white ground, 1px `rule-strong` stroke, 2px radius, `0.5rem 0.65rem`, body size, full width. A ruled writing line, not a floating box.
- **Focus:** stroke goes SRM blue with a 3px blue-wash glow, native outline suppressed. Everything else focuses through a global 2px SRM-blue `:focus-visible` ring at 2px offset.
- **Code variant:** monospace with 0.04em tracking, for register numbers and reference codes, so a transposed digit is visible while typing.
- **Label:** the 0.6875rem uppercase label, always above the control.
- **Hint / Error:** 0.8125rem in label ink and rejected red respectively, `0.5rem` below the control.
- **Disabled:** `paper-sunk` ground, faint ink.

### Cards / Containers (the Sheet)
- **Corner Style:** 3px cut edge. **Background:** white paper. **Border:** 1px `rule`. **Internal Padding:** 1.5rem, or 0 on the flush variant for full-bleed contents.
- **Header:** 2px `rule-ink` under a 1.0625rem/600 title — the masthead rule.
- **Shadow Strategy:** none; see Elevation & Depth.
- Below 48rem the sheet loses its radius and side borders and bleeds to the viewport edges.

### Chips
- **Style:** monospaced 0.8125rem on white with a `rule-strong` stroke and 2px radius, `0.125rem 0.5rem`.
- **State:** none. Chips carry codes and tags, not sentiment; they have no coloured variants and no selected state.

### State Marks
Uppercase 0.6875rem at 0.07em with a 5px `currentColor` dot, on the state's wash at 2px radius. Four states: draft (sunk paper), pending, approved, rejected. This replaces the coloured status pill: it is a mark on a document, sized like a label, not a filled capsule.

### Navigation
- The topbar is the letterhead: white paper, sticky, closed by a 2px `rule-ink` — never dark console chrome. Brand lockup (institution mark at 30px plus a 0.6875rem/0.12em "BaseCamp") sits left, tabs stretch across the middle in a horizontally scrollable strip with the scrollbar hidden, and the user menu sits right.
- Tabs are body-size, 500 weight, label ink, with a transparent 2px bottom border pulled onto the topbar's own rule via `margin-bottom: -2px`. Hover goes ink; active goes SRM blue with a blue underline that reads as a tab in a ledger. Tabs carry a 16px line icon before the label.
- The user menu opens a 13rem dropdown: 3px radius, `rule-strong` stroke, overlay lift, a ruled header carrying name and email, and items that fill `paper-sunk` on hover (rejected red for sign out).

### The Counterfoil Stub
The signature component and the answer to density. A full-width three-column button row (`auto 1fr auto`) closed by a hairline rule, carrying a 3px perforation on its leading edge, a monospaced reference code, an ink title at 500, and a state mark. Hover fills `paper-sunk` over 140ms; the last stub in a run drops its rule. A queue is a run of stubs; opening one unfolds the full slip. Stubs are never nested and never given a border, a shadow, or a radius.

### The Signature Strip
The document's authority record and where the primary action lives. A wrapping flex row of 9rem cells opened by a `rule-strong` top rule. Each cell is a 2.25rem mark area closed by a solid `rule-ink` bottom rule, with the signer's name set in Source Serif 4 at 1.0625rem, over a 0.6875rem uppercase attribution. An unsigned cell keeps the same geometry with a dashed `rule-strong` rule — a ruled blank, exactly as on paper. When the last authority lands, the `countersigned` mark appears: a gold-ringed, gold-washed inline mark. That is the whole gold budget.

### Register Readings
Counts read off a register, not hero tiles. A heavy top rule opens the grid; each reading is a 0.6875rem uppercase label above a monospaced tabular figure at 1.75rem/500 in ink, closed by a hairline. No icon (the icon slot is explicitly `display: none`), no accent, no card, no elevation.

### Ledger Tables
Full-width, collapsed borders, body size. Heads are 0.6875rem uppercase label ink on `paper-sunk`, closed by a 2px `rule-ink`. Cells are body ink with hairline rules and a `paper-laid` row hover. Numeric columns switch to monospace at 0.8125rem with tabular figures. Below 48rem the head is hidden and the same data reads as stubs.

### Modal
A settling slip: `slip-settle` at 260ms over a 160ms scrim fade, `min(46rem, 100%)` wide, 88vh max (92vh on mobile), white, 3px radius, overlay lift. The header is a 1.375rem serif title closed by a 2px `rule-ink`; the footer is right-aligned actions above a 1px `rule`.

### Timeline (audit trail)
A 1px `rule-strong` spine with 9px paper-filled dots ringed in `rule-ink`; the active entry's dot fills SRM blue. Elapsed time reads as visible length along the spine rather than as a timestamp string.

### Empty States
A blank form, not an illustration: `3rem 1.5rem` of dashed `rule-strong` at 3px radius, label ink, with an ink title. The dashed edge is the same "waiting to be filled" signal the unsigned signature cell uses.

### Auth Screen
Below 60rem, a single white column on laid paper. At and above 60rem, a 1:1 split with a solid SRM blue side panel carrying the white logo, a serif headline, and body text tinted from the ground's own hue (`#ccd6ea`) rather than flat grey. The panel's ground is a ruled field: white lines at 0.035 alpha on a 2.75rem pitch, masked to fade out below 55% so the panel has direction instead of an even wash.

### Brand Lockup
The institution's mark is used as issued, never redrawn or recoloured. The colour asset is a JPEG on a white ground and carries `mix-blend-mode: multiply` so it sits correctly on warm form stock; the white variant renders normally on the blue panel. Heights in use: 30px in the topbar, 34px on the auth card, 44px on the auth panel.

## Do's and Don'ts

### Do:
- **Do** build composition out of ruled field blocks: a 0.6875rem uppercase label above its value, closed by a 1px hairline.
- **Do** open every document band with the 2px `rule-ink` masthead rule — page header, card header, modal header, table head.
- **Do** set every reference code, register number, timestamp, and count in monospace with tabular figures.
- **Do** carry queue density with counterfoil stubs; open a stub to unfold the full slip.
- **Do** put the primary action in the signature strip, where a signature would go.
- **Do** keep radius at 2px for controls and 3px for surfaces — a cut edge.
- **Do** state a document state in an uppercase word plus a dot before any colour is applied.
- **Do** grow controls to a 2.75rem minimum target below 48rem while leaving type sizes alone.
- **Do** theme browser surfaces from the palette — selection, caret, `accent-color`, scrollbars, focus rings, underline offset, tabular numerals.
- **Do** draw icons as 14–18px line SVGs sitting beside a label, never carrying meaning alone.

### Don't:
- **Don't** spend seal gold on anything but `countersigned`. One use, product-wide.
- **Don't** use SRM blue on anything that neither acts nor marks the user's current position.
- **Don't** ship the coloured status pill or the grey card list; a state is a mark on a document.
- **Don't** nest cards, or give a stub, stat reading, or field block a border, shadow, or radius.
- **Don't** build hero-metric tiles: a count is a label over a monospaced figure with no icon.
- **Don't** add a shadow to anything that is not literally above the page (modal, dropdown, wizard card).
- **Don't** use a zero-offset halo shadow; every shadow here has a real offset and blur.
- **Don't** add a second entrance animation or stagger `slip-settle` down a list.
- **Don't** reference the migration-bridge tokens (`--bg-color`, `--surface-alt`, `--border`, `--primary`, `--primary-light`, `--text-main`, `--text-muted`) in new work — they are deprecated aliases scheduled for deletion.
- **Don't** set body copy, labels, or controls in Source Serif 4, and don't set prose in monospace.
- **Don't** use a placeholder in place of a field label.
- **Don't** style spacing with inline `style` props; every measure comes from the seven-step scale in a stylesheet.
