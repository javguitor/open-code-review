## Context

Two output shapes are needed from one translation: a summary for the review body and positioned comments for the diff. GitHub only accepts inline comments on lines that appear in the PR diff, so the producer (the skill) and the consumer (the dashboard) need a stable, validated contract.

## Decisions

- **Two files, JSON for comments.** `final-human.md` stays prose; `final-human-comments.json` (`{ comments: [{ path, line, start_line?, side, severity, body }] }`) is machine-read. Rejected: embedding comments in markdown front matter (fragile to parse, mixes prose and data).
- **Severity is both a field and a localized label.** `severity` (`blocking|should_fix|optional|nit`) is language-independent for tooling; the `body` starts with the localized label (`Bloqueante:`, `Importante:`, `Opcional:`, `Nit:`) for the human reader.
- **Lines are on the head side.** `line` is the line in the new version of the file, `side` is always `RIGHT`, so the dashboard can validate against the hunks of the round's `diff.patch`. Rejected: GitHub diff `position` (changes whenever the diff changes).
- **Unmappable comments move to the body.** Findings outside any hunk are appended to the body under a localized heading instead of being dropped or failing the whole review.
- **Spare the driver on close.** `stateClose` runs inside the process that the driver execution tracks; closing it with -4 mislabels a normal finish. The dashboard finalizes the driver with the real exit code. The liveness sweep (dead process) keeps closing drivers. Rejected: mapping -4 to success when the workflow is complete (hides real cancellations that happen to follow completion).
- **`pr_author` nullable, no default.** Older sessions stay NULL; the dashboard may look the author up on demand.

## Risks

- A model may emit lines that are not in the diff: handled by the body fallback.
- Invalid JSON from the skill: the dashboard treats a missing or unparsable file as "no inline comments" and posts the body only.
