import type { GitHubReviewState } from '@open-code-review/platform/verdict'
import type { SessionStatus, WorkflowType, FindingTriage, FindingSeverity, ChatTargetType, RoundTriage, PostReviewStep } from '../../shared/types'
import type { IdeType } from './utils'
import type { SynthesisPrior } from '@open-code-review/persistence'

export type { SessionStatus, WorkflowType, FindingTriage, FindingSeverity, ChatTargetType, RoundTriage, PostReviewStep }

export type SessionSummary = {
  id: string
  branch: string
  status: SessionStatus
  workflow_type: WorkflowType
  current_phase: string
  phase_number: number
  current_round: number
  current_map_run: number
  started_at: string
  updated_at: string
  // Dashboard-derived per-workflow progress (not in CLI schema)
  has_review: boolean
  has_map: boolean
  review_phase_number: number
  review_phase: string
  map_phase_number: number
  map_phase: string
  latest_verdict: string | null
  latest_blocker_count: number
  latest_round_status: string | null
  /** When the latest round was posted to GitHub (null = not posted). */
  latest_posted_at: string | null
  latest_posted_url: string | null
  // PR-targeted sessions (null for branch/staged/range targets)
  base_ref: string | null
  head_ref: string | null
  head_sha: string | null
  pr_number: number | null
  pr_url: string | null
  /** true = the PR's head moved past `head_sha`; null = n/a or the lookup failed. */
  stale: boolean | null
  /** The PR's current head commit (for "PR moved to <sha7>"). */
  pr_head_sha: string | null
  /** Detail endpoint only: where the PR worktree lives. */
  worktree_path?: string | null
  /** GitHub login of the PR author; null for non-PR sessions or when unknown (older sessions). */
  pr_author?: string | null
  /** Detail endpoint only: the PR worktree exists and no other session uses that PR, so deleting may also remove it. */
  worktree_removable?: boolean
  /** Detail endpoint only: absolute root finding links are built against (PR worktree when it exists, else the repo root). */
  code_root?: string
  /** Detail endpoint only: `code_root` is the PR worktree (false = the worktree is gone or the session is not a PR). */
  code_root_is_worktree?: boolean
  // Requirements source recorded for the session (null when none)
  requirements_source_url: string | null
  requirements_updated_at: string | null
  requirements_title: string | null
  /** Whether the source was fetched with `--with-comments`; null when unknown. */
  requirements_with_comments: boolean | null
  /** true = the source changed after the review; null = n/a or the lookup failed. */
  requirements_stale: boolean | null
  requirements_current_updated_at: string | null
}

/** Response of `POST /api/sessions/:id/check-updates`. */
export type CheckUpdatesResponse = Pick<SessionSummary, 'head_sha' | 'stale' | 'pr_head_sha'> &
  Pick<SessionSummary, 'requirements_stale' | 'requirements_current_updated_at'> & {
    requirements_error?: string
    /** The PR-head lookup failed (the requirements fields are still valid). */
    pr_error?: string
  }

export type RequirementsSourceType = 'clickup' | 'github-issue' | 'github-pr' | 'file' | 'text'

export type RequirementsSource = {
  type: RequirementsSourceType
  id: string
  url: string
  title: string
  fetched_at: string
  updated_at: string
  author: string | null
  with_comments: boolean
  description_format: 'markdown' | 'plain'
}

export type RequirementsPreviewErrorCode =
  | 'missing-token'
  | 'invalid-source'
  | 'not-found'
  | 'fetch-failed'
  | 'session-not-found'

/** Response of `POST /api/requirements/preview` (HTTP 200 for both shapes). */
export type RequirementsPreview =
  | { ok: true; source: RequirementsSource; preview: string; files: null }
  | { ok: false; code: RequirementsPreviewErrorCode; error: string }

/** Response of `GET /api/requirements/detect`. */
export type RequirementsCandidates = {
  candidates: Array<{ url: string; type: 'clickup' | 'github-issue' }>
}

/** Response of `GET /api/sessions/:id/requirements`. */
export type SessionRequirements = {
  normalized: string | null
  sources: Array<{ files: { md: string; json: string }; source: RequirementsSource }>
}

export type OrchestrationEvent = {
  id: number
  session_id: string
  event_type: string
  phase: string | null
  phase_number: number | null
  round: number | null
  metadata: string | null
  created_at: string
}

export type DashboardStats = {
  totalSessions: number
  activeSessions: number
  completedReviews: number
  completedMaps: number
  filesTracked: number
  unresolvedBlockers: number
}

export type ReviewRound = {
  id: number
  session_id: string
  round_number: number
  verdict: string | null
  blocker_count: number
  suggestion_count: number
  should_fix_count: number
  final_md_path: string | null
  parsed_at: string | null
  /** Set once the round was posted to GitHub (null = never posted). */
  posted_at?: string | null
  posted_url?: string | null
  /** GitHub login of the PR author (reviews list); null for non-PR sessions or unknown. */
  pr_author?: string | null
  reviewer_outputs: ReviewerOutput[]
  progress?: RoundProgress | null
  /** Counts on current (possibly revised) severities. */
  current_counts?: RoundCounts
  /** Same counts excluding findings decided dismissed / wont_fix / fixed. */
  open_counts?: RoundCounts
  /** Verdict recomputed from `open_counts`; null when the round has no verdict. */
  verdict_after_decisions?: string | null
  /** What the round's findings are; absent on payloads from older servers (reads as `reviewer`). */
  findings_kind?: FindingKind
}

/** Which table a finding lives in. Ids of the two kinds collide numerically. */
export type FindingKind = 'reviewer' | 'synthesis'

export type RoundCounts = { blockers: number; should_fix: number; suggestions: number }

export type ReviewerOutput = {
  id: number
  round_id: number
  reviewer_type: string
  instance_number: number
  file_path: string
  finding_count: number
  parsed_at: string | null
}

export type Finding = {
  id: number
  reviewer_output_id: number
  title: string
  severity: FindingSeverity
  file_path: string | null
  line_start: number | null
  line_end: number | null
  summary: string | null
  is_blocker: number
  parsed_at: string | null
  progress?: FindingProgress | null
}

export type FindingProgress = {
  id: number
  finding_id: number
  status: FindingTriage
  updated_at: string
}

export type RoundProgress = {
  id: number
  round_id: number
  status: RoundTriage
  updated_at: string
}

// ── Agent sessions (per-instance lifecycle journal) ──

export type AgentSessionStatus =
  | 'spawning'
  | 'running'
  | 'done'
  | 'crashed'
  | 'cancelled'
  | 'orphaned'

export type AgentSessionRow = {
  id: string
  workflow_id: string
  vendor: string
  vendor_session_id: string | null
  persona: string | null
  instance_index: number | null
  name: string | null
  resolved_model: string | null
  phase: string | null
  status: AgentSessionStatus
  /**
   * Derived process role — branch on this to tell what kind of process the row
   * is, instead of parsing `command`. `supervisor` = a workflow-owning process
   * (a dashboard-spawned review/map); `instance` = a reviewer instance journaled
   * via `ocr session start-instance`; `utility` = a fire-and-forget command.
   */
  kind: 'supervisor' | 'instance' | 'utility'
  pid: number | null
  started_at: string
  last_heartbeat_at: string
  ended_at: string | null
  exit_code: number | null
  notes: string | null
}

export type AgentSessionsResponse = {
  workflow_id: string
  agent_sessions: AgentSessionRow[]
}

// ── Terminal handoff payload (Spec 5) ──

// Mirror of server-side ResumeOutcome. Keep in sync with
// `packages/dashboard/src/server/services/capture/session-capture-service.ts`.
//
// Discriminated union: `kind: 'resumable'` carries a copyable vendor
// command pair; `kind: 'unresumable'` carries a typed reason + structured
// diagnostics. The panel switches on `kind` and never fabricates a
// command for the unresumable path.
//
// Single-source for the union: re-exported from the server-side
// `unresumable-microcopy.ts` (which derives the type from the
// `ALL_UNRESUMABLE_REASONS` const-assertion). Type-only imports get
// erased by the bundler, so this never pulls server runtime into the
// client bundle. Round-3 SF3: closes the previous client/server
// drift risk by eliminating the hand-maintained mirror.
// Import for local use in `ResumeOutcome` below AND re-export — a bare
// `export type { … } from` re-exports without binding the name in this module.
import type { UnresumableReason } from '../../server/services/capture/unresumable-microcopy'
export type { UnresumableReason }

export type CaptureDiagnostics = {
  vendor: string | null
  vendorBinaryAvailable: boolean
  invocationsForWorkflow: number
  sessionIdEventsObserved: number
  remediation: string
  microcopy: {
    headline: string
    cause: string
    remediation: string
  }
}

export type ResumeOutcome =
  | {
      kind: 'resumable'
      vendor: string
      vendorSessionId: string
      hostBinaryAvailable: boolean
      vendorCommand: string
    }
  | {
      kind: 'unresumable'
      reason: UnresumableReason
      diagnostics: CaptureDiagnostics
    }

export type HandoffPayload = {
  workflow_id: string
  /** Project root the resume command should `cd` into. Hoisted from
   *  ResumeOutcome arms (round-3 Suggestion 4). */
  projectDir: string
  outcome: ResumeOutcome
}

// ── Team composition ──

export type ReviewerInstance = {
  persona: string
  instance_index: number
  name: string
  model: string | null
}

export type TeamResolvedResponse = {
  team: ReviewerInstance[]
}

// ── Model discovery ──

export type ModelDescriptor = {
  id: string
  displayName?: string
  provider?: string
  tags?: string[]
}

export type ModelListResponse = {
  vendor: 'claude' | 'opencode' | null
  source: 'native' | 'bundled' | null
  models: ModelDescriptor[]
  /** Why the bundled list is being served. Present iff source is "bundled". */
  nativeUnavailableReason?: string
}

/** The synthesized finding that merged a reviewer finding (synthesized rounds only). */
export type SynthesizedBy = {
  id: number
  key: string
  title: string
  /** null while the synthesized finding has no decision. */
  decision_status: DecisionStatus | null
}

export type ReviewerOutputDetail = ReviewerOutput & {
  /**
   * Rows carry `retired_at` (server `buildFindingViews`); retired ones are not counted.
   * `synthesized_by` is present only in a synthesized round (null: merged into nothing live).
   */
  findings: Array<Finding & { retired_at?: string | null; synthesized_by?: SynthesizedBy | null }>
}

export type Artifact = {
  id: number
  session_id: string
  artifact_type: string
  round_number: number | null
  file_path: string
  content: string
  parsed_at: string
}

export type MapRun = {
  id: number
  session_id: string
  run_number: number
  map_md_path: string | null
  parsed_at: string | null
  sections: MapSection[]
}

export type MapSection = {
  id: number
  map_run_id: number
  section_number: number
  title: string
  description: string | null
  file_count: number
  reviewed_count: number
  files: MapFile[]
}

export type MapFile = {
  id: number
  section_id: number
  file_path: string
  role: string | null
  lines_added: number
  lines_deleted: number
  display_order: number
  is_reviewed: boolean
  reviewed_at: string | null
}

export type SectionDependency = {
  fromSection: number
  fromTitle: string
  toSection: number
  toTitle: string
  relationship: string
}

export type ChatConversation = {
  id: string
  session_id: string
  target_type: ChatTargetType
  target_id: number
  status: 'active' | 'expired'
  created_at: string
  last_active_at: string
}

export type ChatMessage = {
  id: number
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export type ChatToolStatus = {
  tool: string
  detail: string
  timestamp: number
}

// ── Live event stream (Phase 1 → 3) ──
//
// Mirrors the StreamEvent shape command-runner persists to JSONL and emits
// on the `command:event` socket channel. The server is authoritative; this
// type is a hand-mirror because the server lives in an unbundled package
// and the client can't directly import its types. Keep it in sync with
// `packages/dashboard/src/server/services/ai-cli/types.ts`.

export type NormalizedStreamEvent =
  | { type: 'message'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_call'; toolId: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_input_delta'; toolId: string; deltaJson: string }
  | { type: 'tool_result'; toolId: string; output: string; isError: boolean }
  | { type: 'error'; source: 'agent' | 'process'; message: string; detail?: string }
  | { type: 'notice'; level: 'info' | 'warning'; code: string; message: string }
  | { type: 'session_id'; id: string }
  /** Ends a turn; a `--print` run may start more turns (background sub-agent
   *  completions arrive as a burst of results followed by a new turn). */
  | { type: 'result'; isError: boolean; subtype?: string }

export type StreamEvent = NormalizedStreamEvent & {
  executionId: number
  agentId: string
  parentAgentId?: string
  timestamp: string
  seq: number
}

export type CommandEventsResponse = {
  execution_id: number
  events: StreamEvent[]
}

export type PrOwnership = 'own' | 'other' | 'unknown'

export type PostCheckResult = {
  authenticated: boolean
  prNumber: number | null
  prUrl: string | null
  branch: string | null
  ownership: PrOwnership
  error?: string
}

export type PostSubmitResult =
  | {
      success: true
      commentUrl: string | null
      state: GitHubReviewState
      downgraded: boolean
      worktree: PostWorktreeOutcome
    }
  | { success: false; error: string; code?: 'needs-recheck' | 'invalid-payload' }

/** Severity of an inline comment of the human review (`final-human-comments.json`). */
export type PostCommentSeverity = 'blocking' | 'should_fix' | 'optional' | 'nit'

export type PostPreviewComment = {
  path: string
  line: number
  start_line?: number
  side: 'RIGHT' | 'LEFT'
  severity: PostCommentSeverity
  body: string
}

/** `post:preview-result`: what `post:submit` would publish for a round. */
export type PostPreviewResult = {
  /** Summary body (moved comments already appended under their heading). */
  body: string
  /** The human summary alone, without the moved comments (what the user edits and sends). */
  summary: string
  /** Comments anchored to lines present in the round's diff. */
  inline: PostPreviewComment[]
  /** Comments whose line is not in the diff; already folded into `body`. */
  moved: PostPreviewComment[]
  /** `final-human.md` exists (false = `body` is the team `final.md`). */
  hasHuman: boolean
}

export type AiCliPreference = 'auto' | 'claude' | 'codex' | 'opencode' | 'off'

export type WorktreeCleanup = 'keep' | 'on-close' | 'after-post'

/** Allow-listed settings of `GET`/`PATCH /api/config` (GET also returns project/IDE/AI CLI fields). */
export type ConfigSettings = {
  worktrees: {
    /** Absolute directory that holds the PR worktrees. */
    dir: string
    /** `worktrees.dir` as written in config.yaml; null when unset. */
    dir_raw: string | null
    exists: boolean
    cleanup: WorktreeCleanup
  }
  language: string
  /** `posting.language` as written in config.yaml; null when unset (same as `language`). */
  posting_language: string | null
  /** `dashboard.ai_cli` as configured (raw preference). */
  ai_cli: AiCliPreference
  /** Installed AI CLI binaries, the active one (null = read-only), and the preference. */
  aiCli: { available: string[]; active: string | null; preferred: string }
  /** Editor that finding links open (`dashboard.ide`, else detected). */
  ide: IdeType
  integrations: { clickup_token: 'configured' | 'missing' }
}

/** Body of `PATCH /api/config`; omitted keys are left untouched. */
export type ConfigPatchBody = {
  worktrees?: { dir?: string; cleanup?: WorktreeCleanup }
  language?: string
  posting?: { language: string }
  dashboard?: { ai_cli: AiCliPreference }
}

/** `GET /api/sessions/:id/worktree` (404 for non-PR sessions). */
export type SessionWorktree = {
  pr_number: number
  /** Registered path, or the expected `<dir>/pr-<n>` when absent. */
  path: string
  /** Null when the CLI could not be read (see `error`): unknown, not absent. */
  exists: boolean | null
  dirty: boolean | null
  cleanup: WorktreeCleanup
  error?: string
}

export type WorktreeRemoveStatus = 'removed' | 'dirty' | 'not-found' | 'active-session' | 'error'

/** Response of `POST /api/sessions/:id/worktree/remove` (the CLI's JSON; 409 adds `execution`). */
export type WorktreeRemoveResult = {
  pr_number: number
  status: WorktreeRemoveStatus
  path?: string
  error?: string
}

export type SessionDeleteWorktreeStatus =
  | 'removed'
  | 'dirty'
  | 'not-found'
  | 'error'
  | 'skipped-shared'
  | 'skipped-no-pr'

/** Response of `DELETE /api/sessions/:id` (HTTP 200). */
export type SessionDeleteResult = {
  deleted: true
  status: 'deleted' | 'already-absent'
  worktree: { status: SessionDeleteWorktreeStatus; error?: string } | null
}

/** `code` of a 409 from `DELETE /api/sessions/:id`. */
export type SessionDeleteRefusal = 'not-closed' | 'in-flight' | 'outside-root'

/** What `after-post` cleanup did, reported on `post:submit-result`. */
export type PostWorktreeOutcome =
  | 'removed'
  | 'kept_dirty'
  | 'kept_config'
  | 'kept_error'
  | 'kept_active'
  | 'kept_running'
  | 'none'

/** Server `chat:notice` payload. */
export type ChatNotice = { conversationId: string; sessionId: string; code: 'worktree-missing' | 'worktree-unknown' | 'provider-changed' }

// ── Review workbench ──

export type DiffLine = {
  type: 'ctx' | 'add' | 'del'
  oldNo: number | null
  newNo: number | null
  text: string
  noNewline?: boolean
}

export type DiffHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string
  lines: DiffLine[]
}

export type DiffFileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'binary'

export type DiffFile = {
  oldPath: string | null
  newPath: string | null
  status: DiffFileStatus
  oldMode?: string
  newMode?: string
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

export type DiffFileSummary = Omit<DiffFile, 'hunks'> & { hunk_count: number }

/** Response of `GET /api/sessions/:id/rounds/:n/diff` (404 `{error:'no-diff'}` when none was saved). */
export type DiffResponse =
  | { truncated: false; files: DiffFile[] }
  | { truncated: true; files: DiffFileSummary[] }

/** Response of `GET /api/sessions/:id/rounds/:n/file?path=&from=&to=`. */
export type FileSlice = {
  path: string
  from: number
  to: number
  total_lines: number
  lines: { no: number; text: string }[]
}

export type DecisionStatus =
  | 'unread'
  | 'read'
  | 'acknowledged'
  | 'confirmed'
  | 'dismissed'
  | 'fixed'
  | 'wont_fix'

export type VerificationStatus = 'pending' | 'reproduced' | 'supported' | 'dismissed'

export type FindingDecision = {
  status: DecisionStatus
  reason: string | null
  decided_at: string | null
}

export type PreviousRoundDecision = {
  /** Kind of the earlier finding; absent on payloads from older servers. */
  kind?: FindingKind
  finding_id: number
  round_number: number
  status: DecisionStatus
  reason: string | null
  decided_at: string
}

export type SourceEarlierDecision = {
  status: DecisionStatus
  reason: string | null
  decided_at: string | null
}

/** A reviewer finding merged into a synthesized one (read-only provenance). */
export type SynthesisSource = {
  finding_id: number
  reviewer_output_id: number
  /** `principal-1` style, no `@`. */
  reviewer: string
  reviewer_type: string
  instance_number: number
  title: string
  severity: FindingSeverity
  category: string | null
  file_path: string | null
  line_start: number | null
  line_end: number | null
  summary: string | null
  /** Decision made on this copy before the round gained synthesized findings. */
  earlier_decision: SourceEarlierDecision | null
}

export type FindingLocation = { file_path: string; line_start?: number | null; line_end?: number | null }

type FindingViewCommon = {
  id: number
  title: string
  severity: FindingSeverity
  category: string | null
  synthesis_severity: FindingSeverity
  synthesis_category: string | null
  /** Primary location for a synthesized finding. */
  file_path: string | null
  line_start: number | null
  line_end: number | null
  summary: string | null
  is_blocker: number
  parsed_at: string | null
  flagged_by: string[]
  evidence: string | null
  verification_status: VerificationStatus | null
  verification_note: string | null
  verified_at: string | null
  verification_file: string | null
  decision: FindingDecision | null
  progress?: FindingProgress | null
  revision_count: number
  previous_round_decision: PreviousRoundDecision | null
  /** Set when the finding left the synthesis; kept for history and excluded from counts. */
  retired_at: string | null
}

export type ReviewerFindingView = FindingViewCommon & {
  kind: 'reviewer'
  reviewer_output_id: number
}

export type SynthesizedFindingView = FindingViewCommon & {
  kind: 'synthesis'
  /** `S1`-style key assigned by the Tech Lead. */
  key: string
  /** Every location; `[0]` is the primary one. */
  locations: FindingLocation[] | null
  sources: SynthesisSource[]
  /** Prior-feedback classification; null when the round had none. */
  prior?: SynthesisPrior | null
}

/** One row of `GET /api/sessions/:id/rounds/:n/findings` (current values + provenance). */
export type FindingView = ReviewerFindingView | SynthesizedFindingView

export type FindingRevision = {
  id: number
  /** Id in the table of the finding's kind. */
  finding_id: number
  field: 'severity' | 'category' | 'status' | 'verification_status'
  old_value: string | null
  new_value: string | null
  reason: string
  source: 'user' | 'chat' | 'verifier'
  conversation_id: string | null
  created_at: string
}

/** Response of `GET /api/findings/:id`. */
export type FindingDetail = FindingView & { revisions: FindingRevision[] }
