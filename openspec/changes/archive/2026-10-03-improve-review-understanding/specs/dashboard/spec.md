## ADDED Requirements

### Requirement: Mermaid Diagrams in Markdown

The markdown renderer SHALL render fenced ```mermaid code blocks as diagrams. The diagram renderer SHALL be lazy-loaded so Mermaid is fetched only when a document contains a diagram, and SHALL be initialized with `securityLevel: 'strict'` for markdown content, which derives from untrusted text. The code-review map SHALL keep `'loose'` because it needs node click handlers. On a render error the renderer SHALL show the error text and the diagram source in a code block.

#### Scenario: Diagram rendered

- **GIVEN** `final.md` contains a ```mermaid block
- **WHEN** the round view renders it
- **THEN** the block SHALL be shown as a diagram and not as plain code

#### Scenario: Invalid diagram

- **GIVEN** a ```mermaid block with invalid syntax
- **WHEN** it is rendered
- **THEN** the error and the diagram source SHALL be shown
- **AND** the rest of the document SHALL render normally

### Requirement: Posted State Visible and Fresh

On a successful `post:submit` carrying a session and round, the dashboard server SHALL record the post on the round (URL when known, else NULL), save the database and emit `session:updated`; a failure to record SHALL be logged and SHALL NOT fail the post. Session summaries SHALL expose `latest_posted_at` and `latest_posted_url` of the latest round; reviews list rows SHALL expose `posted_at` and `posted_url`. The session card, session detail and reviews list SHALL show a "Posted" badge, linking to the URL in a new tab with `rel="noopener"` when known. The sessions page SHALL offer a "Not posted" filter for closed review sessions whose latest round has no `posted_at`. The sessions list and detail queries SHALL refetch on window focus, and a successful post SHALL invalidate the sessions and reviews queries.

#### Scenario: Post recorded and lists refreshed

- **WHEN** a review is posted successfully
- **THEN** the round SHALL be marked posted
- **AND** `session:updated` SHALL be emitted so open lists refresh

#### Scenario: Recording failure does not fail the post

- **GIVEN** recording the post throws
- **WHEN** the review was already sent to GitHub
- **THEN** the post SHALL still report success
- **AND** a warning SHALL be logged

#### Scenario: Stale tab repaired on focus

- **GIVEN** a sessions list tab that missed a socket event
- **WHEN** the window regains focus
- **THEN** the list SHALL refetch
