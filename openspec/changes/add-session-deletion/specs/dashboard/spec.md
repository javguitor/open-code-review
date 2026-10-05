## ADDED Requirements

### Requirement: Delete Session Action

The dashboard SHALL offer a delete action for a session on its card in the sessions list and in the session detail header, behind a confirmation dialog, backed by `DELETE /api/sessions/:id`, which runs `ocr state delete <id> --json` (with `--remove-worktree` when requested) as a tracked execution rather than deleting by itself.

#### Scenario: Confirmation states what is deleted

- **GIVEN** a closed session
- **WHEN** the user clicks the delete action
- **THEN** a confirmation dialog SHALL state that the session's files, rounds, findings, chats, events and command history are deleted permanently
- **AND** nothing SHALL be deleted until the user confirms

#### Scenario: Worktree option in the dialog

- **GIVEN** the session's PR worktree exists and no other session uses that PR
- **WHEN** the confirmation dialog opens
- **THEN** it SHALL show a "also remove the worktree" option, checked by default
- **AND** the result of the worktree removal (removed, kept because dirty or in use, failed) SHALL be shown after the deletion

#### Scenario: Delete from the list

- **WHEN** the user confirms the deletion from a session card
- **THEN** the card action SHALL NOT open the session detail
- **AND** the session SHALL disappear from the list without a page reload

#### Scenario: Delete from the detail page

- **WHEN** the user confirms the deletion from the session detail header
- **THEN** the dashboard SHALL navigate to the sessions list

#### Scenario: The route delegates to the CLI

- **WHEN** `DELETE /api/sessions/:id` is called
- **THEN** the server SHALL run `ocr state delete <id> --json` as a tracked execution visible in the Commands history
- **AND** it SHALL answer 200 for `deleted` or `already-absent`, 409 with the code for `refused`, and 500 with the CLI's error otherwise

#### Scenario: Other clients refresh

- **GIVEN** two browser tabs show the sessions list
- **WHEN** a session is deleted in one tab, or with `ocr state delete` from a terminal
- **THEN** the server's DB watcher SHALL notice the missing row and emit `session:deleted` with the session id
- **AND** the other tab SHALL drop the session from its list

#### Scenario: Active session cannot be deleted

- **GIVEN** an `active` session or one with a running execution
- **WHEN** the user views its delete action
- **THEN** the action SHALL be disabled with an explanation, and a request that still reaches the server SHALL get 409 with the reason code shown to the user
