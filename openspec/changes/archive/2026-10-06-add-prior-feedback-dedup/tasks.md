## 1. Persistence
- [x] 1.1 Migration 23: nullable `synthesis_findings.prior_json`; persist/read it with the synthesized finding
- [x] 1.2 `round-meta.ts`: validate optional `prior` (`status` enum; `refs` required and well-formed when status ≠ `new`); tests
- [x] 1.3 Query: prior OCR findings for a `pr_number` across sessions/rounds (excluding the current round) with decision and posted state; tests

## 2. CLI
- [x] 2.1 `ocr pr prior-feedback <pr> --session-id <id> [--json]`: GitHub GraphQL (threads with isResolved/isOutdated/path/line/author kind, review bodies, conversation comments; paginated; capped bodies) + OCR history; writes `rounds/round-N/prior-feedback.json`; `gh` failure recorded as `github.available: false`, exit 0
- [x] 2.2 Tests with a scripted `gh` runner (threads/reviews/comments mapping, bot detection, pagination, failure path, history query)

## 3. Agents
- [x] 3.1 `workflow.md` Phase 7 step 0 (PR targets): run `ocr pr prior-feedback` after the reviewers and discourse, before classifying; never copied into files reviewers read; non-PR targets skip
- [x] 3.2 `workflow.md` Phase 7: classify each synthesized finding against `prior-feedback.json` (`new`/`open`/`resolved_still_present`/`changed`/`dismissed` + refs) and include `prior` in the `complete-round` payload; reviewers unchanged
- [x] 3.3 `final-template.md`: mark already-reported items (status + link)
- [x] 3.4 `translate-review-to-single-human.md`: posting policy (suppress `open`; one summary line for `open` blockers; never post `dismissed`; cite the original for `resolved_still_present`)
- [x] 3.5 `nx run cli:update`

## 4. Dashboard
- [x] 4.1 Synthesis finding API exposes `prior`; "Already reported" badge with status and links (en + es)

## 5. Verification
- [x] 5.1 `openspec validate add-prior-feedback-dedup --strict`
- [x] 5.2 `nx run-many -t lint test typecheck build --skip-nx-cache`
- [x] 5.3 Manual: run `ocr pr prior-feedback` against a real smith PR with threads/reviews (read-only) and check the JSON
