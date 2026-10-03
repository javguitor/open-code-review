## 1. Persistence and CLI
- [x] 1.1 Migration 19: nullable `sessions.pr_author`; `SessionRow`, insert/update, `stateInit`/`stateShow`/`stateList`
- [x] 1.2 `ocr state begin --pr-author <login>`; `ocr state show` prints it
- [x] 1.3 `stateClose` spares the driver execution; children are still closed
- [x] 1.4 Tests: migration, begin/show round trip, cascade spares driver

## 2. Skill
- [x] 2.1 `pr-target.md` outputs `pr_author`; `workflow.md` and `map-workflow.md` pass `--pr-author`
- [x] 2.2 Rewrite `translate-review-to-single-human.md` (language policy, no AI/tooling references, localized severity labels, two output files)

## 3. Dashboard
- [ ] 3.1 Expose `pr_author` in session and reviews APIs and UI
- [ ] 3.2 `post:preview` and `post:submit` with inline comments in one review
- [ ] 3.3 Post dialog: human review as the primary path
- [x] 3.4 `posting.language` (separate posting language): config reader/writer, settings UI, `post-handler` preview/compose/prompt
