## 1. Agents
- [x] 1.1 `final-template.md`: new template (overview with task / step-by-step in implementation order / 1–2 diagrams; verdict with why; problems in prose ending with location + `**ID**`; no process sections) and updated synthesis steps
- [x] 1.2 `workflow.md` Phase 7 step 8 and the `flagged_by`/`evidence` wording (language policy and translation exclusions need no change: `## What This Change Does` and the parsed tokens are kept)
- [x] 1.3 `nx run cli:update`

## 2. Verification
- [x] 2.1 `openspec validate update-final-review-readability --strict`
- [x] 2.2 `nx run-many -t lint test typecheck --skip-nx-cache`
- [x] 2.3 Parse a final.md written with the new template with the dashboard parser (verdict and counts unchanged)
- [ ] 2.4 Manual: re-synthesize a real round with the new template and check it in the dashboard
