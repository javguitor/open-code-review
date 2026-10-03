## ADDED Requirements

### Requirement: Comment-Preserving Config Writes

The system SHALL provide a writer for an allow-listed set of `.ocr/config.yaml` keys (`worktrees.dir`, `worktrees.cleanup`, `language`) that preserves comments, formatting and every other key, writes atomically, and never overwrites a file it cannot parse.

#### Scenario: Edit keeps the rest intact

- **GIVEN** a `config.yaml` with comments and other keys
- **WHEN** `worktrees.dir` is set through the writer
- **THEN** only that value changes and the rest of the file, comments included, is unchanged

#### Scenario: Missing file

- **GIVEN** no `config.yaml`
- **WHEN** a value is set
- **THEN** a minimal file containing that key is created

#### Scenario: Invalid input

- **WHEN** a key outside the allow-list or an invalid value (bad language tag, unknown cleanup mode, empty path) is submitted
- **THEN** nothing is written and the error names the key

#### Scenario: Unparseable file

- **GIVEN** a `config.yaml` that fails to parse
- **WHEN** a value is set
- **THEN** the write aborts with the parser error and the file is untouched

### Requirement: Worktree Cleanup After Post

The `worktrees.cleanup` setting SHALL accept `after-post` in addition to `keep` and `on-close`.

#### Scenario: Removed after a successful post

- **GIVEN** `worktrees.cleanup: after-post` and a PR session with a worktree
- **WHEN** a review for that session is posted to GitHub successfully (any state)
- **THEN** the worktree is removed unless it has uncommitted changes, in which case it is kept and reported

#### Scenario: Other modes unchanged

- **GIVEN** `keep` or `on-close`
- **WHEN** a review is posted
- **THEN** the worktree is left as those modes define
