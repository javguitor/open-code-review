## Context

Today: `requirements.md` is written by the Tech Lead from whatever the user typed or
referenced (`workflow.md` 1d); the dashboard passes `Requirements: <text>` in the
prompt; reviewers output a "Requirements Assessment" (Met / Partially Met / Not Met /
Cannot Assess). There is no fetcher, no record of where requirements came from, and no
way to notice that they changed. Node ≥ 20 provides global `fetch`; `gh` is already an
optional dependency; the CLI already owns every write to session state.

## Goals / Non-Goals

- Goals: paste a ClickUp URL (or issue URL, or path) and get reviewers evaluating
  against numbered acceptance criteria; keep the raw source verbatim next to the
  normalized file; credentials stay in the environment; the model never fetches.
- Non-Goals: two-way sync with ClickUp; a requirements editor; automatic use of
  requirements without the user choosing them.

## Decisions

- **Decision: code fetches, the Tech Lead normalizes.** Deterministic adapters produce
  `requirements/source*.md` + `.json`; Phase 1 derives `requirements.md`. The raw copy
  is what reviewers can quote; the normalized file is what they assess against. Each
  acceptance criterion carries `(quoted)` or `(derived)` so a reviewer's "Not Met" can be
  traced to the card's words or to an inference.
  - Alternative: the agent reads the URL (WebFetch / an MCP). Rejected: private cards
    need the API token; the fetch would not be testable; and a summary without the
    original loses provenance.
  - Alternative: generate a `spec.md` committed to the repo. Rejected: it duplicates a
    living document and pollutes the repo; the session already holds `requirements.md`.
- **Decision: adapters in the CLI, exposed as `ocr requirements fetch`.** The dashboard
  runs the CLI (`--json`) like it does for state; one implementation, testable with
  recorded HTTP/`gh` fixtures (`fetch` and `execBinary` injectable). ClickUp: task id
  from URLs of the forms `https://app.clickup.com/t/<id>` and
  `https://app.clickup.com/t/<team>/<custom-id>`; `GET https://api.clickup.com/api/v2/task/{id}?include_markdown_description=true`
  with header `Authorization: $CLICKUP_API_TOKEN`; comments from
  `/api/v2/task/{id}/comment` when `--with-comments`. GitHub: `gh issue view <url>
  --json title,body,comments,updatedAt` / `gh pr view <url> --json …`.
- **Decision: source files.** `requirements/source.md`: `# <title>` + `Source: <url>` +
  `Updated: <iso>` + `## Description` (markdown as provided) + `## Checklists` + `##
  Custom Fields` (name: value) + `## Comments` (author, date, text; only with
  `--with-comments`). `requirements/source.json`: `{ type, id, url, title, fetched_at,
  updated_at, author, with_comments }`. Second source → `source-2.*`. The normalized
  `requirements.md` keeps its current place at the session root (manifest unchanged
  for consumers).
- **Decision: normalization template** `references/requirements-normalization.md`:
  Phase 1 reads every `requirements/source*.md`, writes `requirements.md` with `## Source`
  (one line per source with its link), `## Acceptance Criteria` (`### AC-1: …` with
  `(quoted)`/`(derived)`), `## Out of Scope`, `## Open Questions`; it must not drop
  anything stated in the source; it may add derived criteria only when the source
  implies them and must label them. Reviewers' "Requirements Assessment" rows reference
  `AC-n`. Language policy applies (English headings/labels, prose in `language`).
- **Decision: PR-link detection is a suggestion.** `routes/requirements.ts`
  `GET /api/requirements/detect?pr=<url>` scans the PR body for ClickUp/GitHub-issue
  URLs and returns candidates; the form shows "Use requirements from …". The CLI prints
  the same hint when a PR target's body contains links. Never fetched without a click
  (or `--requirements <url>`).
- **Decision: staleness.** Sessions gain `requirements_source_url` and
  `requirements_updated_at`; "Check for updates" (shared with PR-head staleness) runs
  `ocr requirements fetch --json --dry-run` to read the provider's `updated_at` only and
  shows "Requirements changed on <date>". No automatic re-review.
- **Decision: credentials.** `CLICKUP_API_TOKEN` only from the environment the
  dashboard/CLI runs in (child-env inheritance already exists); never read from
  `config.yaml`; never logged; the settings screen (other change) shows "configured /
  missing" without the value.

## Risks / Trade-offs

- ClickUp markdown vs HTML descriptions: `include_markdown_description=true` returns
  `markdown_description`; fall back to `description` (plain text) and say so in
  `source.json`.
- Large cards with many comments inflate prompts: comments are opt-in and capped at
  the last 50; the Tech Lead quotes, not pastes, in `requirements.md`.
- Prompt injection via card content: `source.md` is user content inside the session;
  the Tech Lead treats it as requirements text, not instructions (same rule as
  `--reviewer` text in `workflow.md` Phase 4).

## Migration Plan

Additive: new files under `requirements/`, two nullable columns, new commands and
routes. Sessions without sources behave as today.

## Open Questions

- Should `requirements.md` be regenerated on a new round when the source changed, or
  only on `--fresh`? Proposed: regenerate on new round only when the user accepts the
  "Requirements changed" banner's "Refresh" action.

## How to execute this change (handoff)

Same working agreement (Sonnet subagents per block, disjoint files, commit per block,
OCR review in Spanish before merge, archive after). Order: after
`add-pr-worktree-review` (PR-link detection uses `pr_url`) — the CLI adapters and the
normalization template do not depend on it and can go first. Prior art: `pr-head.ts`
(stage 3) for a cached provider lookup; `post-handler.ts` tests for injectable runners;
`language-config.ts` tests for file fixtures.
