## 1. CLI adapters and command

- [x] 1.1 `packages/cli/src/requirements/types.ts`: `RequirementSource = { type: 'clickup' | 'github-issue' | 'github-pr' | 'file' | 'text'; id; url; title; body; checklists; customFields; comments?; updatedAt; author }`; `detectSourceType(input)`.
- [x] 1.2 `clickup.ts`: URL/id parsing (`/t/<id>`, `/t/<team>/<custom-id>`), fetch with injectable `fetch`, markdown description with plain-text fallback, checklists, custom fields, optional comments (last 50). Tests with recorded JSON fixtures; missing token → clear error naming `CLICKUP_API_TOKEN`.
- [x] 1.3 `github.ts` (via `gh`, injectable runner), `file.ts`, `text.ts`. Tests.
- [x] 1.4 `commands/requirements.ts`: `ocr requirements fetch <source> [--with-comments] [--session <id>] [--json] [--dry-run]` → writes `requirements/source[-n].md` + `.json` into the session dir (or prints with `--json --dry-run`); `ocr requirements list --session <id>`. Tests against a temp session dir.
- [x] 1.5 `packages/shared/persistence`: migration adds `requirements_source_url`, `requirements_updated_at` to `sessions`; `ocr state begin --requirements-url --requirements-updated-at` (or set by `requirements fetch --session`).

## 2. Skill

- [x] 2.1 `references/requirements-normalization.md` (template + rules: nothing dropped, quoted/derived labels, AC numbering, language policy).
- [x] 2.2 `workflow.md` Phase 1 (1d): if `--requirements` is a URL/path → `ocr requirements fetch`; read `requirements/source*.md`; write `requirements.md` per the template; record the source on the session. For `pr:<n>` targets, scan the PR body for ClickUp/issue links and print the suggestion. `session-files.md`: `requirements/` folder. `reviewer-task.md` / `final-template.md`: assessment rows reference `AC-n`.
- [x] 2.3 `commands/review.md`, `map.md`: `--requirements <url|path|text>` documented with examples. `nx run cli:update`.

## 3. Dashboard

- [x] 3.1 `routes/requirements.ts`: `POST /api/requirements/preview { source, withComments }` → runs `ocr requirements fetch --json --dry-run`; `GET /api/requirements/detect?pr=<url>` → candidate links from the PR body (`gh pr view --json body`). Tests with injectable runners.
- [x] 3.2 Command form: Requirements field accepts URL/path/text; "Preview" shows title, updated date, first lines; "Use requirements from <card>" chip when the PR target has detectable links; `--with-comments` toggle. i18n.
- [x] 3.3 Session page: requirements source banner (title, link, updated); "Check for updates" marks "Requirements changed on <date>" (dry-run fetch forced by Check for updates; the sessions list and detail only serve the cached value, so after a restart the banner appears once Check for updates runs); "Refresh requirements" offered only when starting a new round.
- [x] 3.4 Round page / findings: show `AC-n` references from the Requirements Assessment when present. (The round page renders `final.md`, whose Requirements Assessment table lists `AC-n`; the "Requirements" button opens the normalized `requirements.md` to look them up. No separate AC widget.)

## 4. Acceptance

- [ ] 4.1 `ocr requirements fetch <clickup url> --with-comments` on a real card (token in env) → `source.md`/`source.json` correct; same for a GitHub issue URL and a local file. (GitHub PR/issue and file verified 2026-10-03; ClickUp pending: no token/card available.)
- [x] 4.2 `/ocr:review pr:<n> --requirements <clickup url>` → `requirements.md` with numbered ACs (quoted/derived), reviewers' assessments reference `AC-n`, final "Requirements Assessment" table lists them.
- [ ] 4.3 Dashboard: PR with a card link → chip → preview → launch; session banner; edit the card → "Check for updates" shows the change. (Pending: the fork has issues disabled and no ClickUp token was available on 2026-10-03; detection, preview and staleness are covered by route tests with fake runners.)
- [x] 4.4 Missing token → clear error in CLI and dashboard; nothing written.
- [x] 4.5 `nx run-many -t lint test typecheck` green; `openspec validate add-requirements-sources --strict`; OCR review of the branch before merge.
