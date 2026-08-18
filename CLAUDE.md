# CLAUDE.md

## Read HANDOFF.md first

**[HANDOFF.md](HANDOFF.md) is the current state of this project.** Read it
before proposing or changing anything. The two facts that matter most:

1. **v1 is deployed and working.** `supabase/migrations/0001`–`0008` are
   applied to the live instance; the wizard, MFA, invites and invite email
   are all verified end to end against it.
2. **v2 (`supabase/schema-v2/`) is written but has NEVER been applied to any
   database**, and the frontend still targets the v1 schema. Applying v2
   breaks `app/src/lib/`. That work has not been started.

`ARCH.md` is stale — it documents the v1 schema only through `0003`. When it
and the migration files disagree, the files are right.

Three project rules that override anything below:

- **Commit as the git default author.** No `Co-Authored-By` trailers.
- **No fixture data, ever.** One account comes from the wizard (the
  captain); everything else is created by hand by a human at the right
  level.
- **RLS is the authorization boundary**, never a frontend check. Relationship
  checks are `security definer` functions, written once, reused, and always
  pinning `set search_path = public`.

---

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
