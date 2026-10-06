# Change: Make the final review read as an explanation, not as a process log

## Why

The final review (`final.md`, shown as "Revisión final" in the dashboard) is hard to follow for someone who did not run the review. It opens with a two-sentence overview, then lists findings as forms (`**ID**`, `**Flagged by**: @principal-1, @quality-2`, `**Type**`, `**Issue**`, `**Why this blocks**`, `**Evidence**`) and closes with `## Consensus & Dissent` and questions "From @security-1". The reader has to understand the review machinery (agents, discourse, consensus) before understanding the change and its problems. The user wants: what the task wants, what was done step by step, a diagram, and then the problems told in natural language.

## What Changes

- **`## What This Change Does` becomes a real explanation** (heading kept, so posting still excludes it):
  - `**What the task asks**`: the goal in plain words (requirements/card, else PR description).
  - `**How it was built, step by step**`: numbered steps in the **logical order of the implementation** — the base first (data, contracts, types), then the logic that uses it, then where it connects (commands, API), then what the user sees — each step saying what was added and why the next one needs it; files mentioned only in passing.
  - 1–2 Mermaid diagrams: one always (the flow); a second (sequence or before → after) only when several components interact or an existing flow changes.
- **Verdict** keeps `## Verdict`, the verdict value and the count lines (dashboard parser), plus 2–3 plain sentences saying why.
- **Problems in natural language**: `## Blockers` / `## Should Fix` / `## Suggestions` stay (counts, `/ocr:address`), but each item is a plain title plus one or two paragraphs — what happens, why it matters, what to do (evidence woven into the prose) — ending with a single line holding the location and `**ID**: S<n>`. No `Flagged by`, `Type`, `Issue`/`Why this blocks`/`Evidence` form fields.
- **No process details in `final.md`**: no reviewer handles, no `**Reviewers**` header line, no `## Consensus & Dissent`, no `## Individual Reviews`, no discourse references, no "From @reviewer" grouping of questions. That information stays in the dashboard (findings table `flagged_by`, reviewer cards, discussion view) and in `round-meta.json`.
- `## Clarifying Questions` and `## What's Working Well` stay, as plain lists.

## Impact

- Affected specs: `review-orchestration` (Final Review Synthesis, Plain-Language Overview in the Final Review; new Final Review Without Process Details)
- Affected code: `packages/agents/skills/ocr/references/final-template.md` (template + steps), `workflow.md` (Phase 7 step 8 and the `flagged_by`/`evidence` wording); synced to `.ocr/` with `nx run cli:update`. No CLI/dashboard code change: the dashboard parser only needs `## Verdict` and the count lines, kept as they are.
