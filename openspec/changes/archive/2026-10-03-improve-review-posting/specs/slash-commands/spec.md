## ADDED Requirements

### Requirement: PR Author Passed to State Begin

The review and map workflows for a PR target SHALL record the author's GitHub login (`author.login` from `gh pr view`) by passing `--pr-author` to `ocr state begin`.

#### Scenario: PR review records the author

- **WHEN** a review starts for a PR target
- **THEN** `ocr state begin` SHALL receive `--pr-author <login>`

### Requirement: Human-Voice Review Translation

The translate-review command SHALL rewrite a multi-reviewer review as a single human-voice PR review in the configured language, following a PR-review guide: critique the code not the person, first person plural, acknowledge what is good, separate merge-blocking from non-blocking points, be actionable (why, how, example), and offer a short sync when a point is debatable. The output SHALL NOT mention AI, agents, reviewer handles, rounds, sessions, OCR, tooling, or paths under `.ocr/`. It SHALL write two files in the round directory:

- `final-human.md`: short assessment, what is good, blocking points first (one line each with `file:line`), non-blocking points grouped, closing sync offer; no reviewer tables or consensus sections.
- `final-human-comments.json`: `{ "comments": [ { path, line, start_line?, side: "RIGHT", severity, body } ] }`, one entry per finding with a file and line, where `line` is on the new (head) side and `severity` is `blocking`, `should_fix`, `optional` or `nit`.

Each comment body SHALL start with a localized severity label (es: `Bloqueante:`, `Importante:`, `Opcional:`, `Nit:`; en: `Blocking:`, `Should fix:`, `Optional:`, `Nit:`).

#### Scenario: Spanish review

- **GIVEN** `language: es`
- **WHEN** the command runs on a completed round
- **THEN** both files SHALL be written in Spanish with no English fillers
- **AND** every comment body SHALL start with one of the Spanish labels

#### Scenario: Finding without a line

- **WHEN** a finding has no file or line
- **THEN** it SHALL appear in `final-human.md` only, not in `final-human-comments.json`

### Requirement: Posting Language for the Human-Voice Review

The human-voice translation SHALL write the summary, the inline comment labels and the "Other comments" heading in the posting language (`posting.language`, else `language`), read from the `Posting language:` line of its prompt or from `.ocr/config.yaml`. The internal review SHALL keep using `language`.

#### Scenario: Different posting language

- **GIVEN** `language: es` and `posting.language: en`
- **WHEN** the human-voice review is generated
- **THEN** its text and labels SHALL be in English
