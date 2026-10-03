## ADDED Requirements

### Requirement: Synthesized Findings Storage

The database SHALL store the deduplicated findings emitted by the synthesis as first-class rows, linked to the reviewer findings they merge, with their own decisions, verification and revision log (migration 19). The migration SHALL be additive: it SHALL NOT alter or rebuild any existing table.

A round SHALL be considered to use synthesis if and only if it has at least one live (not retired) `synthesis_findings` row. Rounds without such rows SHALL keep every existing per-reviewer-row behaviour.

#### Scenario: Migration is additive

- **GIVEN** a version 18 database with reviewer findings, decisions and revisions
- **WHEN** migration 19 runs
- **THEN** `synthesis_findings`, `synthesis_finding_sources`, `synthesis_finding_decisions` and `synthesis_finding_revisions` exist and are empty
- **AND** every row of `review_findings`, `user_finding_progress` and `finding_revisions` is unchanged

#### Scenario: Sources link synthesized to reviewer findings

- **WHEN** `complete-round` persists a synthesized finding with two sources
- **THEN** one `synthesis_findings` row exists for the round with its `key`, title, severity, category, primary location, full `locations_json`, summary, evidence and `flagged_by`
- **AND** two `synthesis_finding_sources` rows link it to the matching `review_findings` rows, which keep their own decisions and revisions untouched

#### Scenario: Key is unique among live rows of a round

- **WHEN** two live synthesized findings of the same round share a `key`
- **THEN** the database rejects the second row
- **AND** a retired row does not block reuse of its `key`

#### Scenario: Deleting a round cascades

- **WHEN** a round is deleted
- **THEN** its synthesized findings, their source links, decisions and revisions are deleted, and the reviewer findings are deleted by their own existing cascade

#### Scenario: Re-ingestion keeps ids and decisions

- **GIVEN** a synthesized finding with a decision
- **WHEN** the round's `round-meta.json` is re-ingested with the same `key` and the same primary file
- **THEN** the row id and its decision are preserved and the source links are rebuilt from the file

#### Scenario: Human state never moves to another synthesized finding

- **GIVEN** a synthesized finding `S2` with a final decision or revisions
- **WHEN** a re-ingestion no longer contains a finding with key `S2` on the same primary file
- **THEN** the row is retired (`retired_at` set) with its history, its source links are dropped, and it is excluded from counts and the verdict after decisions
- **AND** a row without such state is deleted
- **AND** an incoming finding that matches no live row inserts a new row

## MODIFIED Requirements

### Requirement: Canonical Round Count Derivation

Per-round finding counts SHALL be derived by a single shared rule, defined once
and consumed by every producer and consumer of those counts, so the count
representation cannot drift between the CLI writer and the dashboard reader. The
rule SHALL be a pure function in `@open-code-review/platform`, exported on a
Node-free subpath per `package-architecture`'s `Browser-consumed shared code is
exported on Node-free subpaths` requirement, so the dashboard browser bundle can
import it without dragging in Node built-ins.

The value the rule returns for the `blocker` category is the **canonical round
blocker count** — the domain term used by every consumer (the CLI's directional
verdict check, the synthesizer guidance, the dashboard's mismatch hint) so no
consumer re-derives it or names a TypeScript symbol in its contract.

The rule SHALL key off the canonical finding-category vocabulary
(`blocker / should_fix / suggestion / style`) — not ad-hoc count-field names or
event-metadata keys — and SHALL be, in order of precedence: **when
`synthesis_findings` is present, tally their `category`; otherwise prefer the
deduplicated `synthesis_counts` when present; otherwise derive the per-category
tally from `findings[].category`.**
The `style` category has no named synthesis counter and SHALL be derived from
findings only; this omission SHALL be documented at the shared helper so it is not
"corrected" at a call site.

The directional `synthesis_counts` cross-check SHALL be expressed as
*derive-then-compare* against this same helper: compute the derived per-category
tally once, then assert each present `synthesis_counts.X` is `≥ 0` and does not
exceed the derived tally. When `synthesis_findings` is present, the compared
tally SHALL be the synthesized tally and each present `synthesis_counts.X` SHALL
equal it. It SHALL NOT be a second, independent transcription of the derivation
rule.

#### Scenario: Single source of truth for the derivation rule

- **WHEN** the CLI writer computes round counts and the dashboard reader computes round counts for the same round metadata
- **THEN** both SHALL call the same shared `@open-code-review/platform` derivation function
- **AND** they SHALL produce identical per-category counts for identical input
- **AND** there SHALL be no second or third in-line copy of the "prefer `synthesis_counts` else derive by category" rule

#### Scenario: synthesis_counts is preferred when present

- **GIVEN** round metadata whose `synthesis_counts` is present and that has no `synthesis_findings`
- **WHEN** the shared helper resolves the round counts
- **THEN** it SHALL return the `synthesis_counts` values (the deduplicated totals)

#### Scenario: Counts are derived from categories when synthesis_counts is absent

- **GIVEN** round metadata with no `synthesis_counts` and no `synthesis_findings`
- **WHEN** the shared helper resolves the round counts
- **THEN** it SHALL derive each count as the tally of findings carrying the corresponding `category`

#### Scenario: Synthesized findings take precedence

- **GIVEN** round metadata with `synthesis_findings` holding 1 blocker and 3 should_fix, whose reviewers carry 4 blocker and 9 should_fix entries
- **WHEN** the shared helper resolves the round counts
- **THEN** it SHALL return 1 blocker and 3 should_fix
- **AND** `reviewerCount` SHALL still be derived from `reviewers[]`

#### Scenario: Directional cross-check is derive-then-compare

- **WHEN** round metadata with a present `synthesis_counts` and no `synthesis_findings` is validated
- **THEN** the validator SHALL derive the per-category tally via the shared helper and assert each `synthesis_counts.X` is `≥ 0` and `≤` the derived tally
- **AND** the cross-check SHALL reuse the shared derivation rather than re-implement it

#### Scenario: Counts must equal the synthesized tally

- **WHEN** round metadata with `synthesis_findings` and a present `synthesis_counts` is validated
- **THEN** each `synthesis_counts.X` SHALL equal the synthesized tally of the corresponding category, and a difference is rejected
