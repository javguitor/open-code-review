## Context

After `add-pr-worktree-review`: `getWorktreeConfig(ocrDir)` → `{ dir (absolute),
cleanup: 'keep' | 'on-close' }`; worktree path = `<dir>/pr-<n>`; sessions carry
`pr_number`, `pr_url`, `head_sha`; `ocr worktree remove <n> [--force]` exists
(`packages/cli/src/commands/worktree.ts`, exposed to the dashboard as `ocr worktree … --json`). The dashboard reads
config through `readDashboardConfig` (startup) and `getOutputLanguage` (per request),
never writes it. `yaml` 2.8 is already a dependency of `@open-code-review/config`.

## Goals / Non-Goals

- Goals: the three steps of the flow from the dashboard without hand-editing YAML;
  config edits never destroy the user's comments or unrelated keys; the worktree lives
  exactly as long as the review (discussion included) and is removed on the user's
  terms.
- Non-Goals: a generic config editor; editing `default_team`/`models` (the team page
  already covers the team); remote repos.

## Decisions

- **Decision: allow-listed, comment-preserving writes.** `config-writer.ts`:
  `setConfigValues(ocrDir, patch: { 'worktrees.dir'?: string; 'worktrees.cleanup'?:
  WorktreeCleanup; language?: string })` → `parseDocument(text)` only to validate and
  locate the value (or the end of its parent block), then a **text splice** of that
  value; atomic write (temp file + rename); returns the new text. Unknown keys are rejected at the type level and at runtime.
  Values are validated with the same rules as the readers (`LANGUAGE_TAG`, cleanup
  enum, non-empty path).
  - Alternative: rewrite the file from the parsed object. Rejected: drops comments and
    the template's documentation blocks ("config preserved across updates").
  - Alternative: `setIn` + `doc.toString()`. Rejected during implementation: it re-indents
    comment blocks after nested maps and collapses inline-comment spacing — on this
    repo's `config.yaml` it rewrote 76 of 115 lines; the splice changes only the edited
    line(s).
- **Decision: `PATCH /api/config`** with the same allow-list; response = resolved view
  (`worktrees.dir` absolute, `exists: boolean`, `cleanup`, `language`). Readers that
  cache at startup (`readDashboardConfig`) are not affected because the allow-listed
  keys are read per request; `language` already is. The settings screen reloads the
  config query after saving and tells the user that open pages pick the language up on
  reload.
- **Decision: the dashboard never imports `packages/cli`** (apps never depend on apps;
  CI-enforced). Worktree state and removal go through the CLI binary
  (`ocr worktree list --json`, `ocr worktree remove <n> [--force] --json`, resolved with
  `resolveLocalCli()`), in `services/worktrees.ts`; git logic stays in one place.
- **Decision: chat cwd = code root.** `services/worktrees.ts`:
  `codeRootForSession(ocrDir, session)` → worktree path if `pr_number` and the CLI lists
  that worktree, else `repoRoot`. The chat may read files (`maxTurns: 10`; it was 1,
  which ended the process on the first Read). The chat
  context's first message states the code root; when it falls back, the dashboard shows
  the note (only when the session's `context.md` recorded a worktree as **Code root**;
  an in-place review never had one). The cwd is recomputed on every message, so when a
  worktree disappears mid-conversation the chat continues from the checkout and the
  resumed prompt is prefixed with `Note: the code root is now <path>.` so the model
  knows. A worktree whose directory is gone (`prunable`) counts as absent. Verified:
  `claude --resume` works from a different cwd, so the fallback does not break the chat.
- **Decision: cleanup modes.** `keep` (default), `on-close` (stage 3 semantics, kept for
  back-compat), `after-post` (new): `post-handler.ts`, on `post:submit-result.success`,
  runs `ocr worktree remove <n> --json` for the session's PR and reports
  `worktree: removed | kept_dirty | kept_config | kept_error | kept_active | kept_running | none`; a dirty worktree is
  not removed and the success step shows "Worktree kept: uncommitted changes" with a
  Force button.
  Recommended default in the template comment: `after-post`.
  - Alternative: remove on approve only. Rejected: a "request changes" review usually
    means a new round later, but keeping the worktree should be the user's choice via
    `keep`, not an implicit rule tied to the state.
- **Decision: removal UI calls the CLI**, not git directly: `POST
  /api/sessions/:id/worktree/remove { force?: boolean }` runs `ocr worktree remove <n>
  [--force]` through the tracked command runner (visible in Commands, same code path as
  the CLI) and returns the result.

## Risks / Trade-offs

- Writing the user's config from a web UI: mitigated by the allow-list, validation,
  atomic write and comment preservation; a failed parse of the existing file aborts
  the write with the parser error (never overwrites a file it cannot parse).
- Chat in the worktree exposes the PR's files to the model exactly as reviewers already
  see them; no new trust surface.
- Removing a worktree while a review/verify execution is still running on it: the
  removal route refuses when a tracked execution for that session is `running`.

## Migration Plan

Additive: new cleanup value, new routes, new screen. Existing `on-close` keeps working.
Rollback: revert; config files edited through the UI remain valid YAML.

## Resolved Questions (2026-10-03)

- `ai_cli` is not exposed in the settings screen (read at startup; revisit when the
  dashboard can re-detect adapters without a restart).

## How to execute this change (handoff)

Same working agreement as the previous changes (Sonnet subagents per task block,
disjoint files, commit per block, OCR review in Spanish before merge, archive after).
Execute after `add-pr-worktree-review` is merged. Prior art: `language-config.ts`
(reader shape) for the writer's tests; `post-handler.ts` for the after-post hook and its
`runGh`-style injectable tests; `lib/i18n` for the new copy; `features/reviewers` for a
simple settings-like page layout.
