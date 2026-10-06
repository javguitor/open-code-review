## ADDED Requirements

### Requirement: Prior Feedback Is Gathered for PR Targets

For a PR target, the review workflow SHALL run `ocr pr prior-feedback` after collecting the PR context and before synthesis, and SHALL NOT pass prior feedback to the reviewers, so their analysis stays independent.

#### Scenario: PR review gathers prior feedback

- **GIVEN** a review of a GitHub PR
- **WHEN** the workflow prepares the round
- **THEN** `rounds/round-N/prior-feedback.json` SHALL exist before synthesis
- **AND** the reviewer prompts SHALL NOT include its content

#### Scenario: Non-PR target

- **GIVEN** a review of staged changes or a branch without a PR
- **WHEN** the workflow runs
- **THEN** no prior-feedback step SHALL run and every synthesized finding is `new`

### Requirement: Synthesis Classifies Findings Against Prior Feedback

During synthesis the Tech Lead SHALL compare each synthesized finding with the prior feedback (same problem, helped by file and line) and record `prior` on its `synthesis_findings` entry, with a `status` of `new`, `open`, `resolved_still_present` or `changed`, and `refs` to the original feedback for every status other than `new`.

#### Scenario: New finding

- **GIVEN** no prior feedback describes the problem
- **WHEN** the Tech Lead synthesizes
- **THEN** the finding SHALL have `prior.status: "new"` or no `prior`

#### Scenario: Already reported and still open

- **GIVEN** an unresolved GitHub thread on `a.py:10` describing the same problem as a synthesized finding
- **WHEN** the Tech Lead synthesizes
- **THEN** that finding SHALL have `prior.status: "open"` with a ref to the thread URL and author

#### Scenario: Marked fixed but not fixed

- **GIVEN** a resolved thread, or an earlier OCR finding decided as fixed, whose problem is still present in the reviewed code
- **WHEN** the Tech Lead synthesizes
- **THEN** the finding SHALL have `prior.status: "resolved_still_present"` with a ref to the original

#### Scenario: Code changed since the earlier report

- **GIVEN** an outdated thread whose lines changed, and the problem still present in the new code
- **WHEN** the Tech Lead synthesizes
- **THEN** the finding SHALL have `prior.status: "changed"` with a ref to the original
