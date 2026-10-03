# Change: Requirements from ClickUp, GitHub and files — fetched by code, normalized by the Tech Lead

## Why

Phase 1 already accepts requirements "flexibly" (inline text, a document path, pasted
text) and stores them in `requirements.md`; every reviewer assesses the code against
them (`workflow.md` 1d, `reviewer-task.md`, spec "Requirements Context Input"). The
dashboard forwards a free-text `--requirements` value (`prompt-builder.ts:205-258`).
What is missing is the way the content of a **ClickUp card** (where Javier's projects
define requirements) or a GitHub issue reaches that file: a private card cannot be
web-fetched by the agent, the API token must not travel through prompts, and a card
"summarized" by the model without the original kept makes it impossible to tell what
the card said from what the model inferred.

## What Changes

- **Requirement sources, fetched by code.** `ocr requirements fetch <source>` (and the
  same from the dashboard) resolves a source — ClickUp task URL/id, GitHub issue or PR
  URL (`gh`), local file path, or literal text — and writes two session files:
  `requirements/source.md` (the raw content: title, description, checklists, custom
  fields, and comments with `--with-comments`) and `requirements/source.json` (source
  type, id, URL, `fetched_at`, the provider's `updated_at`, author). Multiple sources
  are allowed (`requirements/source-2.md`, …).
- **Adapters**: ClickUp (`CLICKUP_API_TOKEN` env var; `GET /api/v2/task/{id}` with
  `include_markdown_description=true`; comments via `/task/{id}/comment`), GitHub issue
  / PR body (`gh issue view` / `gh pr view --json title,body,comments`), file, text. A
  source whose adapter needs a credential that is missing fails with a message naming
  the variable; nothing is fetched by the model.
- **Normalization by the Tech Lead in Phase 1** (not a separate LLM step): from
  `requirements/source*.md` it writes `requirements.md` with fixed sections —
  `## Source` (links), `## Acceptance Criteria` (numbered; each marked `quoted` or
  `derived`), `## Out of Scope`, `## Open Questions` — in the configured language with
  the headings in English (language policy). Reviewers and the synthesis reference
  criteria by number (`AC-3`).
- **Auto-detection from the PR**: for `pr:<n>` targets, if the PR body links a ClickUp
  task or a GitHub issue, the dashboard offers "Use requirements from <card>" (one
  click; the CLI path prints the suggestion); never automatic.
- **Traceability and staleness**: the session stores `requirements_source_url` and the
  provider's `updated_at`; the dashboard shows "Requirements changed since the review"
  when a fresh fetch reports a newer `updated_at` (same cache rules as PR-head
  staleness; on demand).
- Dashboard: a "Requirements" field in the review/map command form that accepts a URL,
  a path or text, with a preview of the fetched source before launching.

Not in scope: writing back to ClickUp (comments, status), Jira/Linear adapters (the
adapter interface allows them later), turning requirements into OpenSpec proposals.

## Impact

- Affected specs: `review-orchestration` (ADDED "Requirement Sources", ADDED
  "Requirements Normalization"), `session-management` (ADDED "Requirements Source
  Artifacts"), `cli` (ADDED "Requirements Commands"), `dashboard` (ADDED "Requirements
  Field and Source Preview", ADDED "Requirements Staleness"), `sqlite-state` (ADDED
  "Requirements Source Columns").
- Affected code: new `packages/shared/requirements/` is NOT created — adapters live in
  the CLI (`packages/cli/src/requirements/{clickup,github,file,text}.ts`,
  `commands/requirements.ts`) because the dashboard already shells out to `ocr` for
  state and can call `ocr requirements fetch --json`; `packages/agents` (`workflow.md`
  Phase 1, `references/requirements-normalization.md`, `session-files.md`,
  `commands/review.md`, `map.md`); `packages/shared/persistence` (migration: two
  nullable columns on `sessions`); `packages/dashboard/src/server` (`routes/requirements.ts`
  → runs the CLI, PR-body link detection), client command form + session page banner,
  i18n.
- No new dependency: Node's global `fetch` for ClickUp, `gh` for GitHub.
