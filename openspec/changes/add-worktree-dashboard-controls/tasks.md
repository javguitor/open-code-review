## 1. Config writer (shared)

- [ ] 1.1 `packages/shared/config/src/config-writer.ts`: `setConfigValues(ocrDir, patch)` with the allow-list `worktrees.dir`, `worktrees.cleanup`, `language`; `parseDocument` + `setIn` + atomic write; creates the file from an empty document if missing; aborts on parse error. Export in `package.json`.
- [ ] 1.2 `worktree-config.ts`: `cleanup: 'keep' | 'on-close' | 'after-post'`; template comment documents the three and recommends `after-post`.
- [ ] 1.3 Tests: comments and unrelated keys preserved byte-for-byte outside the edited line; missing file; invalid value rejected; malformed YAML aborts without writing.

## 2. Dashboard server

- [ ] 2.1 `routes/config.ts`: `PATCH /api/config` (allow-list, validation, resolved response incl. `worktrees.dir` absolute + `exists`); `GET` returns the same resolved view.
- [ ] 2.2 `services/worktree-path.ts`: `codeRootForSession(ocrDir, session)` using `git worktree list --porcelain`; tests with a temp git repo.
- [ ] 2.3 `chat-handler.ts`: `cwd` from `codeRootForSession`; first-message context states the code root; fallback note emitted as a `chat:notice`.
- [ ] 2.4 `routes/worktrees.ts`: `POST /api/sessions/:id/worktree/remove { force }` → tracked `ocr worktree remove <n> [--force]`; refuses while an execution for the session is running; `GET /api/sessions/:id/worktree` → `{ path, exists, dirty }`.
- [ ] 2.5 `post-handler.ts`: on successful submit and `cleanup: after-post`, remove the session's worktree (non-force); include `worktree: { removed | kept_dirty | none }` in `post:submit-result`.
- [ ] 2.6 Tests for 2.1, 2.4, 2.5 (classical; `gh`/`git`/`ocr` runners injectable).

## 3. Dashboard client

- [ ] 3.1 `features/settings/settings-page.tsx` + route `/settings` + sidebar entry: fields for worktree directory (with resolved path and existence), cleanup mode (radio with one-line explanations), language (select en/es); Save → `PATCH /api/config`; success/error states; i18n `settings.*`.
- [ ] 3.2 Session detail: worktree block (path, exists, dirty, cleanup mode) with "Remove worktree" (and "Force" when dirty); hidden for non-PR sessions.
- [ ] 3.3 Post dialog success step: worktree outcome line and a "Remove worktree" button when `kept_dirty` or `cleanup: keep`.
- [ ] 3.4 Chat panel: show the code-root note when the server reports a fallback.
- [ ] 3.5 Tests for pure helpers (validation of settings input; cleanup copy mapping).

## 4. Acceptance

- [ ] 4.1 Settings: change the worktree directory to an absolute path and `cleanup` to `after-post`; verify `.ocr/config.yaml` keeps its comments and other keys; the screen shows the resolved path.
- [ ] 4.2 Review the throwaway PR #1 via URL from the palette; worktree created under the new directory; Ask the Team answers from the worktree (ask for a file that only exists on that branch).
- [ ] 4.3 Post the review (comment, own PR) → worktree removed automatically; with `keep`, the session page's "Remove worktree" removes it; a dirty worktree is kept and Force removes it.
- [ ] 4.4 `nx run-many -t lint test typecheck` green; `openspec validate add-worktree-dashboard-controls --strict`; OCR review of the branch before merge.
