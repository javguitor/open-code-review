## ADDED Requirements

### Requirement: Synthesized Findings Contract

`ocr state complete-round` SHALL accept an optional top-level `synthesis_findings` array in the round metadata and SHALL validate it before any write, under the same abort-without-partial-state rule as the `Round Metadata Validation Contract`. Where this requirement and the counts cross-check of that contract differ for a payload that carries `synthesis_findings`, this requirement takes precedence.

Each item SHALL carry a `key` (unique within the payload, matching `^S[0-9]+$`), a `title` (at least the same minimum length as reviewer finding titles), a `category` and `severity` from the existing vocabularies, a `summary` string and a non-empty `sources` array of `{ reviewer, index }`. It MAY carry `locations` (array of `{ file_path, line_start?, line_end? }`, first entry primary), `evidence` (string, same cap as reviewer evidence) and `flagged_by` (same rules as reviewer findings). `reviewer` SHALL be `<type>-<instance>` of an entry of `reviewers[]` (a leading `@` is tolerated); `index` SHALL be a 0-based integer inside that reviewer's `findings[]`.

When `synthesis_findings` is present, the payload SHALL be a complete partition: every reviewer finding SHALL be the source of exactly one synthesized finding. A present `synthesis_counts` SHALL equal the synthesized tally per category, and the verdict/blocker-count check SHALL use the synthesized blocker count. Payloads without `synthesis_findings` SHALL be validated exactly as before.

#### Scenario: Valid synthesized findings accepted

- **GIVEN** a payload where 4 reviewer findings are merged into 2 synthesized findings that together reference each of them once
- **WHEN** the payload is piped to `ocr state complete-round --stdin`
- **THEN** the command succeeds and persists the round with 2 synthesized findings

#### Scenario: Payload without synthesized findings unchanged

- **GIVEN** a payload with no `synthesis_findings`
- **WHEN** it is piped to `complete-round`
- **THEN** it is validated and persisted exactly as before this change

#### Scenario: Orphan reviewer finding rejected

- **GIVEN** a payload where `principal-1` has a finding at index 3 that no synthesized finding lists as a source
- **WHEN** it is piped to `complete-round`
- **THEN** the command exits 7, writes nothing and names `principal-1[3]`

#### Scenario: Duplicated or unresolvable source rejected

- **WHEN** a reviewer finding is listed as a source of two synthesized findings, or a source names an unknown reviewer or an index outside that reviewer's findings
- **THEN** the command exits 7, writes nothing and names the offending source and key

#### Scenario: Duplicate or malformed key rejected

- **WHEN** two items share a `key`, or a key does not match `^S[0-9]+$`
- **THEN** the command exits 7 and writes nothing

#### Scenario: Counts mismatch rejected

- **GIVEN** a payload whose synthesized findings hold 1 blocker
- **WHEN** it carries `synthesis_counts.blockers` of 2
- **THEN** the command exits 7 and writes nothing

#### Scenario: Verdict uses the synthesized blocker count

- **GIVEN** a payload with 4 blocker-category reviewer entries merged into 1 synthesized blocker
- **WHEN** the verdict is `APPROVE`
- **THEN** the command exits 7 because the synthesized blocker count is 1
- **AND** the same payload with verdict `REQUEST CHANGES` is accepted

### Requirement: Finding Commands Address Synthesized Findings

`ocr finding verify`, `revise` and `show` SHALL accept `--synthesis-id <id>` as an alternative to `--id <id>`, exactly one of which is required. `--id` SHALL keep addressing reviewer findings. Each write SHALL update the finding and append its revision in one transaction, as for reviewer findings.

#### Scenario: Verify a synthesized finding

- **WHEN** `ocr finding verify --synthesis-id 7 --status supported --note "..." --file <path>` runs
- **THEN** the synthesized finding stores the verification and a revision with source `verifier` is appended

#### Scenario: Both or neither id given

- **WHEN** a command passes both `--id` and `--synthesis-id`, or neither
- **THEN** it fails with a usage error and writes nothing

#### Scenario: Retired synthesized finding refused

- **WHEN** a command targets a retired synthesized finding
- **THEN** it fails with the `retired` error code and writes nothing
