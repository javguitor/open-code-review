## ADDED Requirements

### Requirement: Synthesized Finding Prior Status

The `synthesis_findings` table SHALL store the prior-feedback classification of each synthesized finding as nullable JSON (`prior_json`, migration 23), and `complete-round` SHALL validate it: `status` in `new`, `open`, `resolved_still_present`, `changed`; `refs` required and well-formed when the status is not `new` (`{ source: "github", url, author, author_kind, kind }` or `{ source: "ocr", session_id, round, key }`).

#### Scenario: Valid prior is persisted

- **WHEN** a `complete-round` payload has a synthesized finding with `prior: { status: "open", refs: [{ source: "github", url, author, author_kind: "human", kind: "thread" }] }`
- **THEN** the row SHALL store it in `prior_json` and the API SHALL return it

#### Scenario: Invalid prior is rejected

- **WHEN** a synthesized finding has `prior.status: "open"` without `refs`, or an unknown status
- **THEN** `complete-round` SHALL exit `7`, write nothing and name the offending key

#### Scenario: Older rounds read as new

- **GIVEN** a round stored before migration 23
- **WHEN** its synthesized findings are read
- **THEN** their prior status SHALL be treated as `new`
