## 1. Config writer (shared)

- [x] 1.1 `packages/shared/config/src/config-writer.ts`: `setConfigValues(ocrDir, patch)` with the allow-list `worktrees.dir`, `worktrees.cleanup`, `language`; `parseDocument` to locate + text splice + atomic write; creates the file from an empty document if missing; aborts on parse error. Export in `package.json`.
- [x] 1.2 `worktree-config.ts`: `cleanup: 'keep' | 'on-close' | 'after-post'`; template comment documents the three and recommends `after-post`.
- [x] 1.3 Tests: comments and unrelated keys preserved byte-for-byte outside the edited line; missing file; invalid value rejected; malformed YAML aborts without writing.

## 2. Dashboard server

- [x] 2.1 `routes/config.ts`: `PATCH /api/config` (allow-list, validation, resolved response incl. `worktrees.dir` absolute + `exists`); `GET` returns the same resolved view.
- [x] 2.2 `services/worktrees.ts`: `listWorktrees`/`removeWorktree`/`codeRootForSession` via `ocr worktree … --json` (no `packages/cli` import); tests with a fake runner.
- [x] 2.3 `chat-handler.ts`: `cwd` from `codeRootForSession`; first-message context states the code root; fallback note emitted as a `chat:notice`.
- [x] 2.4 `routes/worktrees.ts`: `POST /api/sessions/:id/worktree/remove { force }` → tracked `ocr worktree remove <n> [--force]`; refuses while an execution for any session of the PR is running (pid-less rows only within the last 2 h); `GET /api/sessions/:id/worktree` → `{ path, exists, dirty }`.
- [x] 2.5 `post-handler.ts`: on successful submit and `cleanup: after-post`, remove the session's worktree (non-force); include `worktree: removed | kept_dirty | kept_active | kept_running | kept_config | kept_error | none` in `post:submit-result`.
- [x] 2.6 Tests for 2.1, 2.4, 2.5 (classical; `gh`/`git`/`ocr` runners injectable).

## 3. Dashboard client

- [x] 3.1 `features/settings/settings-page.tsx` + route `/settings` + sidebar entry: fields for worktree directory (with resolved path and existence), cleanup mode (radio with one-line explanations), language (select en/es); Save → `PATCH /api/config`; success/error states; i18n `settings.*`.
- [x] 3.2 Session detail: worktree block (path, exists, dirty, cleanup mode) with "Remove worktree" (and "Force" when dirty); hidden for non-PR sessions.
- [x] 3.3 Post dialog success step: worktree outcome line and a "Remove worktree" button when `kept_dirty` (Force), `kept_config` or `kept_error`; none for `kept_active`/`kept_running`.
- [x] 3.4 Chat panel: show the code-root note when the server reports a fallback.
- [x] 3.5 Tests for pure helpers (validation of settings input; cleanup copy mapping).

## 4. Acceptance

- [x] 4.1 Settings: change the worktree directory to an absolute path and `cleanup` to `after-post`; verify `.ocr/config.yaml` keeps its comments and other keys; the screen shows the resolved path.
- [x] 4.2 Review the throwaway PR #1 via URL from the palette; worktree created under the new directory; Ask the Team answers from the worktree (ask for a file that only exists on that branch).
- [x] 4.3 Post the review (comment, own PR) → worktree removed automatically; with `keep`, the session page's "Remove worktree" removes it; a dirty worktree is kept and Force removes it.
- [x] 4.4 `nx run-many -t lint test typecheck` green; `openspec validate add-worktree-dashboard-controls --strict`; OCR review of the branch before merge.
