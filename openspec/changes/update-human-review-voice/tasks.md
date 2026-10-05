## 1. Command
- [x] 1.1 Rewrite the Voice, Severity labels and Output sections of `packages/agents/commands/translate-review-to-single-human.md` for the terse senior-reviewer voice (no fixed labels; `severity` kept in the JSON; new `final-human.md` layout; examples updated)
- [x] 1.2 `nx run cli:update` and review the synced `.ocr/commands/` copy

## 2. Verification
- [x] 2.1 `openspec validate update-human-review-voice --strict`
- [x] 2.2 `nx run-many -t lint test typecheck --skip-nx-cache` (agents doc guards)
- [x] 2.3 Manual: regenerate the human review of a real round and check voice, no labels, every finding kept, valid JSON
