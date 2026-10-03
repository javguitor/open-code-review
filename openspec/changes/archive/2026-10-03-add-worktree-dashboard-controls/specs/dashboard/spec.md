## ADDED Requirements

### Requirement: Settings Screen

The dashboard SHALL provide a settings screen that reads and writes the allow-listed configuration keys through the comment-preserving writer.

#### Scenario: Edit the worktree directory

- **WHEN** the user enters a directory (absolute, repo-relative or `~`-prefixed) and saves
- **THEN** `PATCH /api/config` validates it, writes `worktrees.dir`, and the screen shows the resolved absolute path and whether it exists

#### Scenario: Edit cleanup mode and language

- **WHEN** the user selects a cleanup mode or a language and saves
- **THEN** the values are written and the screen reloads the config; a note says open pages pick the language up on reload

#### Scenario: Nothing else is editable

- **WHEN** the settings screen renders
- **THEN** it exposes only `worktrees.dir`, `worktrees.cleanup` and `language`; other configuration stays in `.ocr/config.yaml`

### Requirement: Chat in the Code Root

Ask the Team SHALL run in the session's code root.

#### Scenario: PR session with a worktree

- **GIVEN** a session with `pr_number` whose worktree exists
- **WHEN** a chat message is sent
- **THEN** the AI CLI runs with the worktree as its working directory and the context names it

#### Scenario: Worktree removed

- **GIVEN** a PR session whose worktree no longer exists
- **WHEN** a chat message is sent
- **THEN** the chat runs in the checkout and the panel shows "worktree removed — answering from the checkout"

### Requirement: Worktree Removal from the Dashboard

The dashboard SHALL show a PR session's worktree state and let the user remove it.

#### Scenario: Session shows the worktree

- **GIVEN** a PR session
- **WHEN** the session page renders
- **THEN** it shows the worktree path, whether it exists, whether it has uncommitted changes, and the cleanup mode in effect; when the worktree list cannot be read (CLI failure) the state is shown as "unknown", never as absent

#### Scenario: Remove

- **WHEN** the user clicks "Remove worktree"
- **THEN** `ocr worktree remove <n>` runs as a tracked execution and the page updates; a dirty worktree is refused with a "Force" option

#### Scenario: Refuse while running

- **GIVEN** a running execution for any session of the same PR (rows without a recorded process count only within the last 2 hours)
- **WHEN** the user tries to remove the worktree
- **THEN** the request is refused with a message naming the execution

#### Scenario: Post dialog outcome

- **WHEN** a review is posted successfully
- **THEN** the success step reports whether the worktree was removed, kept because dirty, or kept by configuration, or kept because it could not be removed, with a "Remove worktree" button only for `kept_dirty` (as Force), `kept_config` and `kept_error`

#### Scenario: Kept while a review is open

- **WHEN** a review is posted successfully while an open review session still uses the worktree
- **THEN** the success step reports it as kept (`kept_active`) and offers no button and no Force

#### Scenario: Kept while a command runs

- **WHEN** a review is posted successfully while an execution of the PR is running
- **THEN** the success step reports it as kept (`kept_running`) and offers no button
