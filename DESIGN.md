---
name: SRMIST BaseCamp
description: An approval is a countersigned document — now themed from frappe-ui's own published scale, light and dark.
colors:
  srm-blue-light: "oklch(0.587 0.174 252.167)"
  srm-blue-dark: "oklch(0.586 0.143 248.605)"
  srm-blue-deep-light: "oklch(0.561 0.168 252.355)"
  srm-blue-deep-dark: "oklch(0.671 0.155 247.709)"
  srm-blue-wash-light: "oklch(0.976 0.011 243.65)"
  srm-blue-wash-dark: "oklch(0.255 0.056 255.801)"
  srm-gold-light: "oklch(0.659 0.142 67.548)"
  srm-gold-dark: "oklch(0.599 0.141 56.803)"
  srm-gold-wash-light: "oklch(0.98 0.015 86.424)"
  srm-gold-wash-dark: "oklch(0.253 0.049 61.325)"
  srm-gold-ink-light: "oklch(0.416 0.099 47.734)"
  srm-gold-ink-dark: "oklch(0.84 0.13 82.404)"
  paper: "#ffffff"
  paper-dark: "oklch(0.239 0 0)"
  paper-laid-light: "oklch(0.979 0 0)"
  paper-laid-dark: "oklch(0.205 0 0)"
  paper-sunk-light: "oklch(0.964 0 0)"
  paper-sunk-dark: "oklch(0.26 0 0)"
  ink-light: "oklch(0.205 0 0)"
  ink-dark: "oklch(0.979 0 0)"
  ink-body-light: "oklch(0.341 0 0)"
  ink-body-dark: "oklch(0.885 0 0)"
  ink-label-light: "oklch(0.586 0 0)"
  ink-label-dark: "oklch(0.683 0 0)"
  ink-faint-light: "oklch(0.683 0 0)"
  ink-faint-dark: "oklch(0.457 0 0)"
  rule-light: "oklch(0.946 0 0)"
  rule-dark: "oklch(0.281 0 0)"
  rule-strong-light: "oklch(0.913 0 0)"
  rule-strong-dark: "oklch(0.341 0 0)"
  rule-ink-light: "oklch(0.205 0 0)"
  rule-ink-dark: "oklch(0.885 0 0)"
  state-draft-light: "oklch(0.586 0 0)"
  state-draft-dark: "oklch(0.683 0 0)"
  state-pending-light: "oklch(0.612 0.136 63.758)"
  state-pending-dark: "oklch(0.638 0.14 62.455)"
  state-pending-wash-light: "oklch(0.98 0.015 86.424)"
  state-pending-wash-dark: "oklch(0.253 0.049 61.325)"
  state-approved-light: "oklch(0.53 0.122 156.15)"
  state-approved-dark: "oklch(0.607 0.116 158.84)"
  state-approved-wash-light: "oklch(0.976 0.014 155.594)"
  state-approved-wash-dark: "oklch(0.244 0.05 156.367)"
  state-rejected-light: "oklch(0.497 0.185 27.335)"
  state-rejected-dark: "oklch(0.639 0.196 24.565)"
  state-rejected-wash-light: "oklch(0.978 0.011 17.34)"
  state-rejected-wash-dark: "oklch(0.25 0.059 19.081)"
  # Login/register are frozen to the pre-retheme literals below,
  # independent of theme — see "Two deliberate exceptions".
  auth-paper-laid: "#faf9f6"
  auth-srm-blue: "#154494"
  auth-srm-blue-deep: "#0f3370"
  auth-ink: "#16161a"
  auth-ink-label: "#6a6c75"
  auth-rule: "#e2e0da"
  auth-paper-sunk: "#f2f1ed"
  auth-rule-strong: "#cdcac2"
typography:
  masthead:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
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
  # Login/register only — frozen, see "Two deliberate exceptions".
  auth-masthead:
    fontFamily: "Source Serif 4, Georgia, serif"
    fontSize: "1.75rem"
  auth-headline:
    fontFamily: "Source Serif 4, Georgia, serif"
    fontSize: "1.375rem"
rounded:
  control: "6px"
  surface: "8px"
  pill: "9999px"
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
    rounded: "{rounded.control}"
    padding: "0.5rem 0.9rem"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.srm-blue-deep}"
    textColor: "#ffffff"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.9rem"
  button-secondary-hover:
    backgroundColor: "{colors.paper-sunk}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-label}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.9rem"
  button-ghost-hover:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.state-rejected}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.9rem"
  button-danger-hover:
    backgroundColor: "{colors.state-rejected-wash}"
  button-success:
    backgroundColor: "{colors.state-approved}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.9rem"
  button-sm:
    padding: "0.3rem 0.6rem"
    typography: "{typography.body-small}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.65rem"
    typography: "{typography.body}"
    width: "100%"
  input-disabled:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink-faint}"
  sheet:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.surface}"
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
    rounded: "{rounded.control}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.label}"
  mark-pending:
    backgroundColor: "{colors.state-pending-wash}"
    textColor: "{colors.state-pending}"
    rounded: "{rounded.control}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.label}"
  mark-approved:
    backgroundColor: "{colors.state-approved-wash}"
    textColor: "{colors.state-approved}"
    rounded: "{rounded.control}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.label}"
  mark-rejected:
    backgroundColor: "{colors.state-rejected-wash}"
    textColor: "{colors.state-rejected}"
    rounded: "{rounded.control}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.label}"
  countersigned:
    backgroundColor: "{colors.srm-gold-wash}"
    textColor: "{colors.srm-gold-ink}"
    rounded: "{rounded.control}"
    padding: "0.25rem 0.75rem"
    typography: "{typography.body-small}"
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-body}"
    rounded: "{rounded.control}"
    padding: "0.125rem 0.5rem"
    typography: "{typography.code}"
  rail-tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-label}"
    padding: "0.75rem"
    typography: "{typography.body}"
  rail-tab-active:
    backgroundColor: "transparent"
    textColor: "{colors.srm-blue}"
  launcher-item:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-label}"
    rounded: "{rounded.control}"
    padding: "1rem"
    typography: "{typography.body-small}"
  avatar:
    backgroundColor: "{colors.srm-blue}"
    textColor: "#ffffff"
    rounded: "50%"
    size: "1.75rem"
  theme-toggle:
    backgroundColor: "{colors.paper-sunk}"
    rounded: "{rounded.control}"
    padding: "2px"
  theme-toggle-active:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
---

# Design System: SRMIST BaseCamp

## Overview

**Creative North Star: "The Countersigned Slip"** — unchanged by the V3 retheme below. BaseCamp is still a book of institutional slips, not a ticket console. Every approval is a document with named fields, a reference code, and a signature strip that fills as authority is added. Structure comes from ruled lines, the way it does on real form stock — the hairline rule under a field, the heavy rule under a masthead, the dashed rule under a signature nobody has given yet. Nothing floats on an unexplained shadow. The surface carries ink-on-paper neutrals, and colour arrives only when it has a job: institution blue where a control acts, seal gold once, on the countersigned state.

The system is dense but never crowded, because density is handled the way a book of slips handles it — with counterfoil stubs. A queue is a run of perforated stubs, each one a reference code, a title, and a state mark; opening one unfolds the whole slip. This is what lets the app hold hundreds of requests without pretending forty paper forms fit on a screen, and it is why the card-list-with-pill pattern is absent by construction rather than by taste.

Two anti-references are confirmed and binding: the SaaS ticket console (grey card list plus coloured status pill) and the friendly-campus-app pastel alternative. Both are refused. Desktop reads as a workspace — the open book, wide margins, many stubs visible at once. Mobile reads as a fast route — one slip, full bleed, controls grown to a thumb-sized 2.75rem while type stays exactly where it is.

**What changed in V3, and why.** The captain's call: retheme the whole component library off `frappe-ui`'s real published design tokens (the `frappe-ui` npm package — this is a Vue 3 library, not installable in this React app, so what was actually ported is its `tailwind/tokens/{colors,radius,effects}.js`, applied through the plain CSS custom properties every component here already reads, not a Tailwind layer on top). That is a palette, radius, and shadow swap, plus genuine light/dark theming — not a structural rewrite. The stub, the field block, the signature strip, the masthead rule, the counterfoil perforation: all of it is exactly as described below. Only the numbers underneath changed.

**Key Characteristics (updated):**
- Rules, not borders: hairlines and heavy rules carry all structure
- Small-caps field labels (0.6875rem, 0.09em tracking) ruled above their values
- Monospaced reference codes, register numbers, timestamps, and figures
- Ink-on-paper neutrals, sourced from frappe-ui's gray/blue/green/red/amber scale; blue only on acting controls; gold exactly once
- 6px / 8px radius (frappe-ui's own scale), not the pre-V3 2–3px cut edge
- Counterfoil stubs instead of cards for density
- Full light/dark theming, a real user choice (Account → Appearance), not a cosmetic toggle bolted on after the fact
- One authored motion moment: a slip settling onto a desk

## Theme: light, dark, and where these numbers come from

Every color in this system is a CSS custom property declared three times in `app/src/index.css`: once under plain `:root` (light, the default), once under `[data-theme="dark"]` (an explicit choice), and once under `@media (prefers-color-scheme: dark)` guarded to not fire when `[data-theme="light"]` is set explicitly (so "system" tracks the OS live). The values in all three come from `frappe-ui`'s own `tailwind/tokens/colors.js` — its `lightMode` and `darkMode` exports respectively, both real oklch values, not approximated hex. `radius.js` and `effects.js` supply the radius scale and elevation (shadow) values the same way.

The practical effect: nothing in `components.css` needed to change to gain dark mode or the new palette. Every primitive (`.sheet`, `.btn`, `.form-input`, `.mark`, `.ledger`, `.field`, `.stub`, …) already consumed `var(--ink)`, `var(--paper)`, `var(--rule)` and so on — the retheme repainted `:root`, and the whole component library followed.

**The toggle.** `Account → Appearance` (`ThemeToggle.tsx`) is a three-way control: Light, Dark, System. It writes to `localStorage['theme']` and sets `data-theme` on `<html>`, matching `frappe-ui`'s own `useColorScheme` composable's contract exactly (same key, same attribute — not a coincidence; an app that later did mount real frappe-ui Vue islands, or just a developer who knows that library, would find the exact same storage shape here). `index.html` carries a small inline script that reads this before React mounts, so the page never flashes light and then repaints dark.

**Two deliberate exceptions**, both frozen to literal (not themed) values in `components.css`, independent of `data-theme`:
- **Login and register** (`.auth-*` in `components.css`, plus a `.auth-wrapper` block that re-pins every shared token — `--paper`, `--ink`, `--rule-strong`, etc. — back to their light values for that whole subtree). Captain's call, V3: these two screens' look is settled and explicitly out of scope. They still use Source Serif 4 for their headline, the pre-retheme blue, and the original radius on their own classes — but shared primitives they use internally, like `.form-input` and `.btn`, are re-pinned to light inside `.auth-wrapper` rather than frozen individually, so a dark-mode visitor doesn't get a black input box on a page that stayed visually light everywhere else. This was a real bug caught live, not a hypothetical.
- **A rendered or printed document** (`.doc-sheet`, `DocumentView.tsx`) stays paper-white regardless of app theme — a document is a document whether the person reading the screen prefers light or dark, and the printed QR code specifically needs to stay dark-on-light to keep scanning reliably.

### Named Rules
**The Shared-Token Rule.** A component reads `var(--ink)`, never a literal color, unless it is one of the two named exceptions above. This is what makes dark mode automatic for everything written after this point, not something to remember to add.

**The No-Flash Rule.** Anything that needs to know the resolved theme before paint (a server-rendered default, an asset choice) reads `index.html`'s inline script's contract — `data-theme` on `<html>`, set before `#root` exists — never waits for a React effect.

## Colors

An ink-on-paper neutral field sourced from frappe-ui's gray scale, frappe-ui's own blue for action, and a seal gold (frappe-ui's amber) spent exactly once.

### Primary
- **SRM Blue** (`{colors.srm-blue}` — frappe blue.600 light / blue.400 dark): appears only where a control acts or a place is current: primary buttons, the active rail tab and its 2px leading rule, focus rings and the input focus glow, the wizard's completed step ticks, the active timeline dot, the avatar disc, links, the auth side panel ground (frozen), and the caret. Never as decoration, never as a background wash behind content.
- **Blue Deep** (`{colors.srm-blue-deep}`): the hover shade of the primary button and of hovered links. No other role. Lighter than the base in dark mode, not darker — standard for a dark UI, where emphasis moves toward brighter rather than away from it.
- **Blue Wash** (`{colors.srm-blue-wash}`): the 3px focus glow on text inputs, and nothing else.

### Secondary
- **Seal Gold** (`{colors.srm-gold}`) and **Gold Wash** (`{colors.srm-gold-wash}`): the ring and ground of the `countersigned` mark, with `{colors.srm-gold-ink}` (frappe amber.900 light / amber.100 dark) for its text. This is the entire gold budget of the system.

### Tertiary
Four document states, each a paired ink and wash, sourced from frappe-ui's amber/green/red scales: **Draft** (`{colors.state-draft}`), **Pending** (`{colors.state-pending}`), **Approved** (`{colors.state-approved}`), **Rejected** (`{colors.state-rejected}`). The ink carries the state; the wash is support. Rejected red doubles as the destructive-action colour (outlined buttons, dangerous menu items); approved green is the only other filled button in the system, used to confirm a decision.

### Neutral
- **Paper** (`{colors.paper}`): sheets, cards, modals, inputs, the index rail, the mobile letterhead and the launcher. White in light mode; frappe gray.900-equivalent in dark.
- **Laid Paper** (`{colors.paper-laid}`): the app ground. frappe gray.50 light, gray.950 dark. Also the hover tint on ledger rows.
- **Sunk Paper** (`{colors.paper-sunk}`): recessed wells — table headers, stub and menu-item hover, disabled inputs, the draft mark's ground.
- **Ink** (`{colors.ink}`): headings, field values, the emphasised cell. The strongest text-on-surface contrast in the system, in either mode.
- **Body Ink** (`{colors.ink-body}`): running text and table cells.
- **Label Ink** (`{colors.ink-label}`): small-caps labels, reference codes, meta, subtitles, ghost-button rest state.
- **Faint Ink** (`{colors.ink-faint}`): placeholders, empty-state icons, scrollbar thumb hover.
- **Rule** (`{colors.rule}`), **Rule Strong** (`{colors.rule-strong}`), **Rule Ink** (`{colors.rule-ink}`): the three-weight ruling vocabulary. Hairline between fields and table rows; strong for input strokes, the signature strip's head, dashed blanks, chip and dropdown outlines, and the perforation; ink for the heavy rule under any masthead, card header, modal header, or table head. In dark mode `rule-ink` is a *light* line on a dark ground — same job (the heaviest rule in the system), inverted surface.

### Named Rules
**The Single Seal Rule.** Seal gold appears exactly once in the product, on `countersigned`. The moment it decorates a heading, a highlight, or a second badge, it stops meaning "verified" and the rule is broken.

**The Acting-Control Rule.** SRM blue marks something that acts or something that is current. If an element neither performs an action nor indicates the user's present position, it is ink and rule, not blue.

**The Ink-First State Rule.** A state is legible in text and rule weight before colour is applied. Every state mark carries an uppercase word and a 5px dot in `currentColor`; the wash is never the whole signal.

### Deprecated
`--bg-color`, `--surface-alt`, `--border`, `--primary`, `--primary-light`, `--text-main`, `--text-muted` are a marked **migration bridge** aliasing the retired indigo system's names onto the current tokens so that remaining inline styles render correctly — and now pick up light/dark automatically through the same alias, since they resolve to the real tokens. They are transitional, not part of the system. Do not reference them in new work; they are deleted when no `.tsx` references remain.

## Typography

**UI Font:** Inter (with the system sans stack) — everything in the product reads this, including what used to be masthead-only serif. This follows `frappe-ui`'s own typography.js, which ships exactly one family for everything.
**Code Font:** ui-monospace / SF Mono (with Cascadia Mono, Roboto Mono)
**Exception:** login and register still set their headline in Source Serif 4 — frozen, see "Two deliberate exceptions" above. Nowhere else in the product uses it.

**Character:** Everything a person reads or operates is Inter; everything that is measurement — reference codes, register numbers, timestamps, counts — is monospaced. Body text runs with slashed zero and tabular figures enabled globally (`cv05`, `ss01`, `tnum`) so a transposed digit in a register number is visible.

### Hierarchy
- **Masthead** (Inter, 600, 1.75rem, 1.2, -0.02em): the document title — page headers, the letterhead title. Drops to 1.5rem below 48rem.
- **Headline** (Inter, 600, 1.375rem): modal titles. Drops to 1.25rem below 48rem.
- **Title** (Inter, 600, 1.0625rem): card and section headers and the brand lockup wordmark.
- **Body** (Inter, 400, 0.9375rem, 1.55): all running text, inputs, buttons, table cells, rail tabs.
- **Body Small** (Inter, 400, 0.8125rem): hints, errors, dropdown meta, small buttons.
- **Code** (mono, 0.8125rem, 0.02em, tabular): reference codes, register numbers, timestamps, chips, and numeric table cells. The register figure in a stat reading is the one place mono runs large, at the 1.75rem masthead size.
- **Label** (Inter, 600, 0.6875rem, 0.09em, uppercase): the small-caps field label. This is a real ramp step, not drift: it is the size of every field label, form label, section title, table header, stat label, and signature attribution. State marks use the same size at 0.07em; the brand sub-lockup uses it at 0.12em.

### Named Rules
**The Mono-Is-Measurement Rule.** Monospace means data you might have to check character by character: reference codes, register numbers, timestamps, counts. It is never a "technical" costume on prose.

**The Label-Over-Value Rule.** A field is a 0.6875rem uppercase label ruled above its value, never a label beside its value and never a placeholder standing in for a label.

**The Auth-Serif Exception.** Source Serif 4 sets exactly the login/register headline and nothing else — not a general masthead font anymore. Introducing it anywhere new is a regression to the pre-V3 system, not a stylistic choice.

## Layout

The page measure is 76rem, centred, with `2rem / 1.5rem / 3rem` padding. Wayfinding lives beside the page, not above it: a 15rem index rail is sticky at full viewport height, carrying the mark under a 2px ink rule, the tabs, and the user at its foot. A ledger is tabbed down its side, and horizontal space spent on navigation is space that keeps — a head-mounted row has to scroll sideways the moment a level is added. Below 60rem the rail is replaced by a slim letterhead and the launcher.

Spacing is a seven-step scale from `0.25rem` to `3rem`, unchanged by the retheme. Field and detail grids are `repeat(auto-fit, minmax(13rem, 1fr))` with column gap only (`0 2rem`) — rows are separated by their own bottom rule, never by gap. Stat readings use `minmax(9rem, 1fr)` with the same column-gap-only rhythm under a heavy top rule. Two-column form grids use `minmax(14rem, 1fr)` with a full `1rem` gap.

**Breakpoints.** Two, both authored. `min-width: 60rem` splits the auth screen into the blue side panel plus form, and is the same line the index rail appears on — below it, navigation becomes the docked launcher. `max-width: 48rem` performs the character shift: masthead sizes shrink, field and detail grids collapse to a single column with zero gap so the slip reads as one continuous run, stat readings go to a fixed two columns, ledger table heads disappear (the same data reads as stubs), the masthead stacks, and sheets go edge-to-edge with a negative inline margin and no radius. Interactive controls grow to a `2.75rem` minimum target — type does not change size. WCAG 2.1 AA is binding on this project.

### Named Rules
**The Full-Bleed Rule, Held Measure Rule.** Structural rules cross the full viewport; content stays on the 76rem measure. Never let a band-separating rule stop at the content edge.

**The Rule-Not-Gap Rule.** Rows in a field grid are separated by a 1px rule, not by vertical gap. Column gap only.

## Elevation & Depth

The system is flat by construction. Depth comes from ruling and tonal paper — `paper` sits on `paper-laid`, wells are `paper-sunk` — not from shadow. Only three things in the product cast a shadow, and all are genuinely lifted off the page: the account dropdown and the modal (overlay lift), and the standalone setup-wizard card (lift). The active segment of the theme toggle also lifts slightly, the same way a pressed tab in frappe-ui's own `ThemeSwitcher` reads as "selected" rather than just "different." Shadow values are `frappe-ui`'s own `effects.js` elevation tokens (`elevation.light.sm` / `.lg`, `elevation.dark.sm` / `.lg`), each with a real offset and blur in both modes — a zero-offset halo is still not part of this system. The modal scrim is `rgba(22,22,26,0.42)` with a 2px backdrop blur in light mode; it does not currently have a dark-mode-specific value and should get one before anyone spends time polishing the modal further.

### Shadow Vocabulary
- **Lift** (`var(--lift)`, frappe `elevation.{light,dark}.sm`): the setup wizard card, the one standing sheet in an otherwise empty viewport; the active theme-toggle segment.
- **Overlay Lift** (`var(--lift-overlay)`, frappe `elevation.{light,dark}.lg`): modals and the account dropdown — surfaces that are actually above the page.

### Motion
One authored moment: **`slip-settle`** (320ms, `cubic-bezier(0.16, 1, 0.3, 1)`) — opacity in from `translateY(-6px) rotate(-0.35deg)`, a slip settling onto a desk. It is reused by the modal at 260ms, paired with a 160ms scrim fade. Everything else is a 140ms colour/border transition on hover and focus — now including the theme swap itself, which is why flipping `data-theme` does not read as a flash. The reduced-motion query collapses all animation and transition to 0.01ms.

### Named Rules
**The Two-Shadow Rule.** Shadows exist only for surfaces that are literally above the page: modals, dropdowns, and the standalone wizard card. Sheets, cards, stubs, stat readings, and inputs are flat.

**The One Settle Rule.** `slip-settle` is the system's authored entrance for anything that arrives on the page. It plays when a slip or modal arrives. It is not a per-section reveal, and it is never chained down a list.

**The launcher's rise.** The mobile launcher is the one sanctioned exception, and it is a surface arriving rather than a slip: `launcher-rise` (280ms in, 220ms reversed on exit, same `--ease`) lifts the panel from the dock that opened it. It is still one moment per surface — the items inside it do not stagger. Smooth scrolling inside the launcher, the board, and every column is part of the same decision, and all of it is dropped under `prefers-reduced-motion`, which the global block does not do for scroll behaviour on its own.

## Shapes

Radius is `6px` (frappe-ui's own "3" token) on controls, marks, chips, and small surfaces, and `8px` ("4") on sheets, cards, modals, and dropdowns. This is a real change from the pre-V3 2–3px "cut paper edge": frappe-ui's scale is a standard rounded-control system, and the captain's ask was explicitly to make the component library "standard compliant." Full-round (`50%`) is still reserved for genuinely circular objects — the avatar, the state-mark dot, the timeline dot, the spinner — and `9999px` for the scrollbar thumb and the wizard's step ticks. Below 48rem, sheets drop their radius and side borders entirely and run edge to edge.

Borders are ruled lines with three weights and two styles. A 1px `rule` hairline separates fields and table rows. A 1px `rule-strong` gives input strokes, the signature strip's head, chip and dropdown outlines, and the stub perforation. A 2px `rule-ink` sits under every masthead, card header, modal header, wizard step bar, and table head — that heavy rule is what says "everything below this is the document body." Dashed `rule-strong` marks a blank: an unsigned signature cell and an empty state are both a dashed edge waiting to be filled.

The recurring silhouette is the perforation: a 3px column of `repeating-linear-gradient(to bottom, rule-strong 0 3px, transparent 3px 7px)` on the leading edge of every stub, the mark of a counterfoil torn from the book.

## Components

### Buttons
- **Shape:** `6px` radius, `0.5rem 0.9rem` padding, 500 weight at body size, 140ms colour transition.
- **Primary:** solid SRM blue on white. Hover deepens to blue-deep (lighter in dark mode). This is the product's principal filled control.
- **Secondary:** paper sheet with a `rule-strong` stroke and ink text; hover fills `paper-sunk` and darkens the stroke to `ink-faint`.
- **Ghost:** transparent with label ink; hover fills `paper-sunk` and darkens to ink.
- **Danger:** paper with a rejected-red stroke and red text; hover fills the rejected wash. Destructive actions are outlined, never filled red.
- **Success:** solid approved-green, used only to confirm an approval decision.
- **Small:** `0.3rem 0.6rem` at 0.8125rem.
- **Disabled:** 0.45 opacity, `not-allowed`.
- **Icon button:** 2rem square, transparent, label ink; hover fills `paper-sunk`, with a red-on-rejected-wash danger variant. Below 48rem all controls grow to a 2.75rem minimum height (small buttons to 2.25rem).

### Inputs / Fields
- **Style:** paper ground, 1px `rule-strong` stroke, `6px` radius, `0.5rem 0.65rem`, body size, full width. A ruled writing line, not a floating box.
- **Focus:** stroke goes SRM blue with a 3px blue-wash glow, native outline suppressed. Everything else focuses through a global 2px SRM-blue `:focus-visible` ring at 2px offset.
- **Code variant:** monospace with 0.04em tracking, for register numbers and reference codes, so a transposed digit is visible while typing.
- **Label:** the 0.6875rem uppercase label, always above the control.
- **Hint / Error:** 0.8125rem in label ink and rejected red respectively, `0.5rem` below the control.
- **Disabled:** `paper-sunk` ground, faint ink.

### Cards / Containers (the Sheet)
- **Corner Style:** `8px` radius. **Background:** paper. **Border:** 1px `rule`. **Internal Padding:** 1.5rem, or 0 on the flush variant for full-bleed contents.
- **Header:** 2px `rule-ink` under a 1.0625rem/600 title — the masthead rule.
- **Shadow Strategy:** none; see Elevation & Depth.
- Below 48rem the sheet loses its radius and side borders and bleeds to the viewport edges.

### Chips
- **Style:** monospaced 0.8125rem on paper with a `rule-strong` stroke and `6px` radius, `0.125rem 0.5rem`.
- **State:** none. Chips carry codes and tags, not sentiment; they have no coloured variants and no selected state.

### State Marks
Uppercase 0.6875rem at 0.07em with a 5px `currentColor` dot, on the state's wash at `6px` radius. Four states: draft (sunk paper), pending, approved, rejected. This replaces the coloured status pill: it is a mark on a document, sized like a label, not a filled capsule.

### Navigation
- The topbar is the letterhead: paper, sticky, closed by a 2px `rule-ink`. In dark mode this is a dark surface, by design — the pre-V3 rule forbidding "dark console chrome" was a light-mode-only system's rule and no longer applies now that dark mode is a real, requested mode, not an unstyled fallback. Brand lockup (institution mark at 30px plus a 0.6875rem/0.12em "BaseCamp") sits left, tabs stretch across the middle in a horizontally scrollable strip with the scrollbar hidden, and the user menu sits right. The mark itself switches its own asset — colour-on-white in light mode, white-on-dark in dark mode (`AppShell.tsx` reads `useResolvedTheme()`) — because the colour asset's `mix-blend-mode: multiply` assumes a light ground and goes nearly invisible on a dark one.
- Tabs are body-size, 500 weight, label ink, with a transparent 2px bottom border pulled onto the topbar's own rule via `margin-bottom: -2px`. Hover goes ink; active goes SRM blue with a blue underline that reads as a tab in a ledger. Tabs carry a 16px line icon before the label.
- The user menu opens a 13rem dropdown: `8px` radius, `rule-strong` stroke, overlay lift, a ruled header carrying name and email, and items that fill `paper-sunk` on hover (rejected red for sign out).

### The Counterfoil Stub
The signature component and the answer to density. A full-width three-column button row (`auto 1fr auto`) closed by a hairline rule, carrying a 3px perforation on its leading edge, a monospaced reference code, an ink title at 500, and a state mark. Hover fills `paper-sunk` over 140ms; the last stub in a run drops its rule. A queue is a run of stubs; opening one unfolds the full slip. Stubs are never nested and never given a border, a shadow, or a radius.

### The Signature Strip
The document's authority record and where the primary action lives. A wrapping flex row of 9rem cells opened by a `rule-strong` top rule. Each cell is a 2.25rem mark area closed by a solid `rule-ink` bottom rule, with the signer's name set in Inter at 1.0625rem (no longer the serif — see the Auth-Serif Exception), over a 0.6875rem uppercase attribution. An unsigned cell keeps the same geometry with a dashed `rule-strong` rule — a ruled blank, exactly as on paper. When the last authority lands, the `countersigned` mark appears: a gold-ringed, gold-washed inline mark. That is the whole gold budget.

### Register Readings
Counts read off a register, not hero tiles. A heavy top rule opens the grid; each reading is a 0.6875rem uppercase label above a monospaced tabular figure at 1.75rem/500 in ink, closed by a hairline. No icon (the icon slot is explicitly `display: none`), no accent, no card, no elevation.

### Ledger Tables
Full-width, collapsed borders, body size. Heads are 0.6875rem uppercase label ink on `paper-sunk`, closed by a 2px `rule-ink`. Cells are body ink with hairline rules and a `paper-laid` row hover. Numeric columns switch to monospace at 0.8125rem with tabular figures. Below 48rem the head is hidden and the same data reads as stubs.

### Modal
A settling slip: `slip-settle` at 260ms over a 160ms scrim fade, `min(46rem, 100%)` wide, 88vh max (92vh on mobile), paper, `8px` radius, overlay lift. The header is a 1.375rem title closed by a 2px `rule-ink`; the footer is right-aligned actions above a 1px `rule`.

### Timeline (audit trail)
A 1px `rule-strong` spine with 9px paper-filled dots ringed in `rule-ink`; the active entry's dot fills SRM blue. Elapsed time reads as visible length along the spine rather than as a timestamp string.

### Empty States
A blank form, not an illustration: `3rem 1.5rem` of dashed `rule-strong` at `8px` radius, label ink, with an ink title. The dashed edge is the same "waiting to be filled" signal the unsigned signature cell uses.

### Theme Toggle
`Account → Appearance`. A segmented control, `6px` radius on the track, `paper-sunk` ground; the active segment sits on `paper` with a `lift` shadow — the same visual grammar a pressed/selected tab uses elsewhere in the system, not a new pattern invented for this one control. Three options, Light / Dark / System, each a 15px icon (sun / moon / monitor) plus label at body-small size.

### Auth Screen
Frozen, see "Two deliberate exceptions." Below 60rem, a single column on laid paper (`#faf9f6`, literal). At and above 60rem, a 1:1 split with a solid SRM blue (`#154494`, literal) side panel carrying the white logo, a Source Serif 4 headline, and body text tinted from the ground's own hue (`#ccd6ea`) rather than flat grey. The panel's ground is a ruled field: white lines at 0.035 alpha on a 2.75rem pitch, masked to fade out below 55% so the panel has direction instead of an even wash. Shared primitives used inside this screen (`.form-input`, `.btn`, `.loading-spinner`) are re-pinned to the same light literals via a block of custom-property overrides on `.auth-wrapper`, so the screen cannot inherit the app's dark tokens through a class it shares with the rest of the product.

### Brand Lockup
The institution's mark is used as issued, never redrawn or recoloured. The colour asset is a JPEG on a white ground and carries `mix-blend-mode: multiply` so it sits correctly on light paper; the white variant renders normally on a dark ground (the blue auth panel, or the rail/topbar in dark mode). Heights in use: 30px in the topbar, 34px on the auth card, 44px on the auth panel. Anything rendering the mark on a surface whose color depends on theme must pick the variant from `useResolvedTheme()`, the way `AppShell.tsx` does — hardcoding `variant="color"` is the bug that shipped first and got caught live (see Theme section).

## Do's and Don'ts

### Do:
- **Do** build composition out of ruled field blocks: a 0.6875rem uppercase label above its value, closed by a 1px hairline.
- **Do** open every document band with the 2px `rule-ink` masthead rule — page header, card header, modal header, table head.
- **Do** set every reference code, register number, timestamp, and count in monospace with tabular figures.
- **Do** carry queue density with counterfoil stubs; open a stub to unfold the full slip.
- **Do** put the primary action in the signature strip, where a signature would go.
- **Do** keep radius at `6px` for controls and `8px` for surfaces.
- **Do** state a document state in an uppercase word plus a dot before any colour is applied.
- **Do** grow controls to a 2.75rem minimum target below 48rem while leaving type sizes alone.
- **Do** theme browser surfaces from the palette — selection, caret, `accent-color`, scrollbars, focus rings, underline offset, tabular numerals.
- **Do** draw icons as 14–18px line SVGs sitting beside a label, never carrying meaning alone.
- **Do** write every new color as `var(--token)`, never a literal, so it carries light and dark automatically.
- **Do** pick a theme-dependent asset (a logo variant, anything else that can't just be a CSS color) through `useResolvedTheme()`, not a hardcoded guess at what surface it will sit on.

### Don't:
- **Don't** spend seal gold on anything but `countersigned`. One use, product-wide.
- **Don't** use SRM blue on anything that neither acts nor marks the user's current position.
- **Don't** ship the coloured status pill or the grey card list; a state is a mark on a document.
- **Don't** nest cards, or give a stub, stat reading, or field block a border, shadow, or radius.
- **Don't** build hero-metric tiles: a count is a label over a monospaced figure with no icon.
- **Don't** add a shadow to anything that is not literally above the page (modal, dropdown, wizard card, the active theme-toggle segment).
- **Don't** use a zero-offset halo shadow; every shadow here has a real offset and blur, in both modes.
- **Don't** add a second entrance animation or stagger `slip-settle` down a list.
- **Don't** reference the migration-bridge tokens (`--bg-color`, `--surface-alt`, `--border`, `--primary`, `--primary-light`, `--text-main`, `--text-muted`) in new work — they are deprecated aliases scheduled for deletion.
- **Don't** set body copy, labels, or controls in Source Serif 4 anywhere outside the frozen auth screen, and don't set prose in monospace.
- **Don't** use a placeholder in place of a field label.
- **Don't** style spacing with inline `style` props; every measure comes from the seven-step scale in a stylesheet.
- **Don't** add a literal hex/oklch color to a component that isn't the auth screen or a printed document — if it needs a new semantic color, add the token to `index.css` in both modes and to this file's frontmatter, don't inline one.
