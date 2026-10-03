import { useState, useEffect, useRef, useCallback } from "react";
import {
  Send,
  X,
  Loader2,
  Check,
  ExternalLink,
  RefreshCw,
  Save,
  Eye,
  Edit3,
  Github,
  FileText,
  User,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Search,
  BookOpen,
  Brain,
  Wrench,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import { MarkdownRenderer } from "../../../components/markdown/markdown-renderer";
import {
  GITHUB_REVIEW_STATES,
  type GitHubReviewState,
} from "@open-code-review/platform/verdict";
import {
  isStateSelectable,
  lockReasonKey,
} from "../../../lib/review-state";
import { usePostReview, type ActivityLogEntry } from "../hooks/use-post-review";
import { useT, type MessageKey } from "../../../lib/i18n";
import { buildSubmitPayload, commentLocation, groupBySeverity, SEVERITY_LABEL_KEY } from "../../../lib/post-preview";
import { removeAction, removeStatusKey, worktreeOutcomeKey } from "../../../lib/worktree-ui";
import { useRemoveWorktree } from "../../sessions/hooks/use-session-worktree";

const REVIEW_STATE_LABEL_KEYS: Record<GitHubReviewState, MessageKey> = {
  approve: "reviews.state_approve",
  "request-changes": "reviews.state_request_changes",
  comment: "reviews.state_comment",
};

type PostReviewDialogProps = {
  sessionId: string;
  roundNumber: number;
  finalContent: string;
  savedHumanReview?: string;
  verdict: string | null;
}

function formatElapsedTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function generationPhaseLabel(
  t: (key: MessageKey) => string,
  hasTools: boolean,
  hasContent: boolean,
  currentTool?: string,
): string {
  if (currentTool === "Write") return t("reviews.phase_rewriting");
  if (hasContent) return t("reviews.phase_writing");
  if (hasTools) return t("reviews.phase_analyzing");
  return t("reviews.phase_starting");
}

function ActivityIcon({ tool }: { tool: string }) {
  switch (tool) {
    case "Read":
      return <BookOpen className="h-3 w-3 shrink-0" />;
    case "Glob":
    case "Grep":
      return <Search className="h-3 w-3 shrink-0" />;
    case "thinking":
      return <Brain className="h-3 w-3 shrink-0" />;
    default:
      return <Wrench className="h-3 w-3 shrink-0" />;
  }
}

export function PostReviewDialog({
  sessionId,
  roundNumber,
  finalContent,
  savedHumanReview,
  verdict,
}: PostReviewDialogProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const streamEndRef = useRef<HTMLDivElement>(null);

  const {
    step,
    checkResult,
    streamingContent,
    generatedContent,
    toolStatus,
    activityLog,
    elapsedSeconds,
    postResult,
    preview,
    requestPreview,
    error,
    needsRecheck,
    reviewState,
    setReviewState,
    recheck,
    checkGitHub,
    generate,
    cancelGeneration,
    saveDraft,
    submitToGitHub,
    reset,
    setStep,
  } = usePostReview(verdict);
  const removeWorktree = useRemoveWorktree(sessionId);
  const resetRemoveWorktree = removeWorktree.reset;
  const [activityExpanded, setActivityExpanded] = useState(true);
  const hasAutoCollapsed = useRef(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [inlineEnabled, setInlineEnabled] = useState(true);
  const previewRequested = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
    setEditMode(false);
    setEditContent("");
    setInlineEnabled(true);
    previewRequested.current = false;
    reset();
    resetRemoveWorktree();
  }, [reset, resetRemoveWorktree]);

  // Open and trigger gh check
  const handleOpen = useCallback(() => {
    setOpen(true);
    checkGitHub(sessionId);
  }, [sessionId, checkGitHub]);

  // Once the PR check passes, learn whether a human review already exists for this round
  useEffect(() => {
    if (step !== "ready" || previewRequested.current) return;
    previewRequested.current = true;
    requestPreview(sessionId, roundNumber);
  }, [step, sessionId, roundNumber, requestPreview]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step !== "generating") close();
    };
    document.addEventListener("keydown", handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, close, step]);

  // Auto-collapse activity log once streaming text begins
  useEffect(() => {
    if (
      step === "generating" &&
      streamingContent &&
      !hasAutoCollapsed.current
    ) {
      hasAutoCollapsed.current = true;
      setActivityExpanded(false);
    }
  }, [step, streamingContent]);

  // Reset collapse flag when a new generation starts
  useEffect(() => {
    if (step === "generating") {
      hasAutoCollapsed.current = false;
      setActivityExpanded(true);
    }
  }, [step]);

  // Auto-scroll during streaming
  useEffect(() => {
    if (step === "generating") {
      streamEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [streamingContent, step]);

  // The content to post — either edited, generated, saved human review, or original final.
  // For the human review this is the summary alone: the server appends the comments that
  // can't go inline (per the inline toggle), so edits are kept and nothing is duplicated.
  const humanBase = (): string =>
    (preview?.hasHuman ? preview.summary : "") ||
    generatedContent ||
    savedHumanReview ||
    finalContent;
  const getPostContent = (): string => {
    if (editMode && editContent) return editContent;
    return humanBase();
  };
  const inlineComments = preview?.hasHuman ? preview.inline : [];
  const movedComments = preview?.hasHuman ? preview.moved : [];

  const prNumber = checkResult?.prNumber ?? 0;
  const posted = postResult?.success ? postResult : null;
  const worktreeAction = posted
    ? removeAction(posted.worktree, removeWorktree.data?.status ?? null)
    : null;

  const ownership = checkResult?.ownership;
  const lockKey = lockReasonKey(ownership);
  const reason = lockKey === null ? null : t(lockKey);
  const stateSelector = (
    <div className="space-y-1.5">
      <div
        role="group"
        aria-label={t("reviews.state_group_aria")}
        className="inline-flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700"
      >
        {GITHUB_REVIEW_STATES.map((state) => (
          <button
            key={state}
            type="button"
            aria-pressed={reviewState === state}
            disabled={!isStateSelectable(state, ownership)}
            onClick={() => setReviewState(state)}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              reviewState === state
                ? "bg-blue-600 text-white"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
            )}
          >
            {t(REVIEW_STATE_LABEL_KEYS[state])}
          </button>
        ))}
      </div>
      {(reason || needsRecheck || (verdict && ownership === "other")) && (
        <p className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            {needsRecheck && error
              ? error
              : (reason ??
                t("reviews.state_suggested", { verdict: verdict ?? "" }))}
          </span>
          {(ownership === "unknown" || needsRecheck) && (
            <button
              type="button"
              onClick={recheck}
              className="inline-flex items-center gap-1 rounded border border-zinc-200 px-1.5 py-0.5 font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <RefreshCw className="h-3 w-3" />
              {t("reviews.recheck")}
            </button>
          )}
        </p>
      )}
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      >
        <Send className="h-3.5 w-3.5" />
        {t("reviews.post_to_github")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={step !== "generating" ? close : undefined}
          />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="post-review-title"
            tabIndex={-1}
            className="relative z-10 flex w-full max-w-4xl flex-col rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
            style={{ maxHeight: "85vh" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
              <h3
                id="post-review-title"
                className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
              >
                {step === "posted"
                  ? t("reviews.review_posted_title")
                  : t("reviews.post_review_to_github")}
              </h3>
              <button
                onClick={close}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                aria-label={t("common.close_dialog")}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {/* Checking step */}
              {step === "checking" && (
                <div className="flex items-center justify-center gap-3 py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {t("reviews.checking_gh")}
                  </p>
                </div>
              )}

              {/* Ready step — choose post mode */}
              {step === "ready" && checkResult && (
                <div className="space-y-4">
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                      <Github className="mr-1.5 inline h-4 w-4" />
                      {t("reviews.pr_on_branch", { number: checkResult.prNumber ?? "" })}{" "}
                      <code className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs dark:bg-zinc-700">
                        {checkResult.branch}
                      </code>
                    </p>
                  </div>

                  {stateSelector}

                  {/* Human review: the primary path */}
                  <button
                    onClick={() =>
                      preview?.hasHuman
                        ? setStep("preview")
                        : generate(sessionId, roundNumber)
                    }
                    className="group w-full rounded-lg border-2 border-emerald-300 bg-emerald-50/40 p-4 text-left transition-colors hover:border-emerald-400 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/10 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/20"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <User className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {preview?.hasHuman
                          ? t("post.view_human")
                          : t("reviews.generate_human")}
                      </span>
                      <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                        {t("post.recommended")}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {t("reviews.generate_human_desc")}
                    </p>
                  </button>

                  {preview?.hasHuman && (
                    <button
                      onClick={() => generate(sessionId, roundNumber)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                    >
                      <RefreshCw className="h-3 w-3" />
                      {t("reviews.regenerate")}
                    </button>
                  )}

                  {/* Team version: secondary */}
                  <div className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      {t("post.team_secondary")}
                    </p>
                    <button
                      onClick={() =>
                        submitToGitHub(
                          buildSubmitPayload({
                            mode: "team",
                            prNumber,
                            content: finalContent,
                            state: reviewState,
                            sessionId,
                            roundNumber,
                            inlineEnabled: false,
                            inlineCount: 0,
                          }),
                        )
                      }
                      className="group flex w-full items-start gap-2 rounded-lg border border-zinc-200 p-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/50 dark:border-zinc-700 dark:hover:border-blue-700 dark:hover:bg-blue-950/20"
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                      <span>
                        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {t("reviews.post_team_review")}
                        </span>
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                          {t("reviews.post_team_review_desc")}
                        </span>
                      </span>
                    </button>
                  </div>

                  {/* Saved human review option */}
                  {savedHumanReview && (
                    <button
                      onClick={() => {
                        setEditContent(savedHumanReview);
                        setStep("preview");
                      }}
                      className="w-full rounded-lg border border-dashed border-zinc-300 p-3 text-left text-sm text-zinc-600 transition-colors hover:border-zinc-400 hover:text-zinc-800 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-300"
                    >
                      <Save className="mr-1.5 inline h-3.5 w-3.5" />
                      {t("reviews.use_saved_human")}
                    </button>
                  )}
                </div>
              )}

              {/* Generating step — phase-aware progress + activity feed */}
              {step === "generating" && (
                <div className="space-y-4">
                  {/* Progress header — phase label + elapsed timer */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="relative flex h-8 w-8 items-center justify-center">
                        <div className="absolute inset-0 animate-ping rounded-full bg-emerald-400/20" />
                        <User className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                          {generationPhaseLabel(
                            t,
                            activityLog.length > 0,
                            !!streamingContent,
                            toolStatus?.tool,
                          )}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {t("reviews.findings_preserved")}
                        </p>
                      </div>
                    </div>
                    <span className="tabular-nums text-xs font-medium text-zinc-400 dark:text-zinc-500">
                      {formatElapsedTime(elapsedSeconds)}
                    </span>
                  </div>

                  {/* Activity feed — collapsible under-the-hood view */}
                  <div className="rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
                    <button
                      type="button"
                      onClick={() => setActivityExpanded((v) => !v)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400"
                    >
                      <Loader2 className="h-3 w-3 animate-spin shrink-0 text-emerald-500" />
                      <span className="flex-1 truncate text-left font-medium">
                        {toolStatus?.detail ?? t("reviews.reading_files")}
                      </span>
                      {activityLog.length > 0 && (
                        <span className="flex items-center gap-1 text-zinc-400 dark:text-zinc-500">
                          <span className="tabular-nums">
                            {activityLog.length}
                          </span>
                          {activityExpanded ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                        </span>
                      )}
                    </button>
                    {activityExpanded && activityLog.length > 0 && (
                      <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-700">
                        <div className="max-h-32 space-y-1 overflow-y-auto">
                          {activityLog.map((entry, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-500"
                            >
                              <ActivityIcon tool={entry.tool} />
                              <span className="truncate">{entry.detail}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Streaming markdown preview (only if AI outputs text directly) */}
                  {streamingContent && (
                    <>
                      <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <Edit3 className="h-3 w-3" />
                        <span className="font-medium">{t("reviews.generated_review")}</span>
                      </div>
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <MarkdownRenderer content={streamingContent} />
                      </div>
                    </>
                  )}
                  <div ref={streamEndRef} />
                </div>
              )}

              {/* Preview step — show generated/edited content */}
              {step === "preview" && (
                <div className="space-y-3">
                  {/* Tab bar */}
                  <div className="flex items-center gap-1 border-b border-zinc-200 dark:border-zinc-700">
                    <button
                      onClick={() => setEditMode(false)}
                      className={cn(
                        "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                        !editMode
                          ? "border-blue-500 text-blue-600 dark:text-blue-400"
                          : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300",
                      )}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {t("reviews.tab_preview")}
                    </button>
                    <button
                      onClick={() => {
                        setEditMode(true);
                        if (!editContent) {
                          setEditContent(humanBase());
                        }
                      }}
                      className={cn(
                        "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                        editMode
                          ? "border-blue-500 text-blue-600 dark:text-blue-400"
                          : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300",
                      )}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      {t("reviews.tab_edit")}
                    </button>
                  </div>

                  {/* Content */}
                  {editMode ? (
                    <textarea
                      value={editContent || humanBase()}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="h-96 w-full rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    />
                  ) : (
                    <div className="space-y-4">
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <MarkdownRenderer content={getPostContent()} />
                      </div>
                      {preview === null && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {t("post.preview_loading")}
                        </p>
                      )}
                      {(inlineComments.length > 0 || movedComments.length > 0) && (
                        <section className="space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                          <label className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                            <input
                              type="checkbox"
                              checked={inlineEnabled}
                              onChange={(e) => setInlineEnabled(e.target.checked)}
                              className="h-4 w-4 rounded border-zinc-300 text-blue-600 dark:border-zinc-600 dark:bg-zinc-800"
                            />
                            {t("post.inline_toggle")}
                          </label>
                          {inlineEnabled && inlineComments.length > 0 ? (
                            <div className="space-y-3">
                              <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                                {t("post.inline_heading", { count: inlineComments.length })}
                              </h4>
                              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                {t("post.inline_hint")}
                              </p>
                              {groupBySeverity(inlineComments).map((group) => (
                                <div key={group.severity} className="space-y-2">
                                  {group.comments.map((c, i) => (
                                    <div
                                      key={`${commentLocation(c)}-${i}`}
                                      className="rounded-md border border-zinc-200 p-3 dark:border-zinc-700"
                                    >
                                      <div className="mb-1 flex items-center gap-2">
                                        <code className="text-xs text-zinc-700 dark:text-zinc-300">
                                          {commentLocation(c)}
                                        </code>
                                        <span
                                          className={cn(
                                            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                                            group.severity === "blocking"
                                              ? "bg-red-500/15 text-red-700 dark:text-red-400"
                                              : group.severity === "should_fix"
                                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                                : "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
                                          )}
                                        >
                                          {t(SEVERITY_LABEL_KEY[group.severity])}
                                        </span>
                                      </div>
                                      <div className="prose prose-sm dark:prose-invert max-w-none">
                                        <MarkdownRenderer content={c.body} />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          ) : (
                            inlineComments.length > 0 && (
                              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                {t("post.inline_off_hint")}
                              </p>
                            )
                          )}
                          {movedComments.length > 0 && (
                            <div className="space-y-1">
                              <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                                {t("post.moved_heading", { count: movedComments.length })}
                              </h4>
                              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                {t("post.moved_hint")}
                              </p>
                              <ul className="list-disc pl-5 text-xs text-zinc-600 dark:text-zinc-400">
                                {movedComments.map((c, i) => (
                                  <li key={`${commentLocation(c)}-${i}`}>
                                    <code>{commentLocation(c)}</code>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </section>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Posting step */}
              {step === "posting" && (
                <div className="flex items-center justify-center gap-3 py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {t("reviews.posting")}
                  </p>
                </div>
              )}

              {/* Posted step */}
              {step === "posted" && (
                <div className="flex flex-col items-center gap-3 py-12">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                    <Check className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t("reviews.review_posted")}
                  </p>
                  {posted?.downgraded && (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {t("reviews.posted_as_comment")}
                    </p>
                  )}
                  {posted && (
                    <div className="flex flex-col items-center gap-2">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {removeWorktree.data?.status === "removed"
                          ? t(removeStatusKey("removed"))
                          : t(worktreeOutcomeKey(posted.worktree))}
                      </p>
                      {worktreeAction && (
                        <button
                          type="button"
                          onClick={() => removeWorktree.mutate({ force: worktreeAction.force })}
                          disabled={removeWorktree.isPending}
                          className={cn(
                            "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40",
                            worktreeAction.force
                              ? "border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
                              : "border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800",
                          )}
                        >
                          {t(worktreeAction.labelKey)}
                        </button>
                      )}
                      {(removeWorktree.error ||
                        (removeWorktree.data && removeWorktree.data.status !== "removed")) && (
                        <p className="text-xs text-red-600 dark:text-red-400">
                          {removeWorktree.error
                            ? removeWorktree.error.message
                            : t(removeStatusKey(removeWorktree.data!.status))}
                        </p>
                      )}
                    </div>
                  )}
                  {(posted?.commentUrl ?? checkResult?.prUrl) && (
                    <a
                      href={posted?.commentUrl ?? checkResult?.prUrl ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {posted?.commentUrl
                        ? t("reviews.view_review")
                        : t("reviews.view_pr")}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              )}

              {/* Error step */}
              {step === "error" && (
                <div className="space-y-4 py-4">
                  <div className="flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
                    <p className="text-sm text-red-700 dark:text-red-300">
                      {error}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 border-t border-zinc-200 px-6 py-4 dark:border-zinc-800">
              {/* Generating footer — cancel button */}
              {step === "generating" && (
                <button
                  onClick={() => cancelGeneration(sessionId, roundNumber)}
                  className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {t("common.cancel")}
                </button>
              )}

              {/* Preview footer — regenerate, save, post */}
              {step === "preview" && (
                <>
                  <div className="mr-auto">{stateSelector}</div>
                  <button
                    onClick={() => generate(sessionId, roundNumber)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t("reviews.regenerate")}
                  </button>
                  <button
                    onClick={() => {
                      saveDraft(sessionId, roundNumber, getPostContent());
                      setDraftSaved(true);
                      setTimeout(() => setDraftSaved(false), 2000);
                    }}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                      draftSaved
                        ? "border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400"
                        : "border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800",
                    )}
                  >
                    {draftSaved ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    {draftSaved ? t("reviews.saved") : t("reviews.save_draft")}
                  </button>
                  <button
                    onClick={() => {
                      const content = getPostContent();
                      saveDraft(sessionId, roundNumber, content);
                      submitToGitHub(
                        buildSubmitPayload({
                          mode: "human",
                          prNumber,
                          content,
                          state: reviewState,
                          sessionId,
                          roundNumber,
                          inlineEnabled,
                          inlineCount: inlineComments.length,
                        }),
                      );
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {t("reviews.post_to_github")}
                  </button>
                </>
              )}

              {/* Error footer — retry or close */}
              {step === "error" && (
                <>
                  <button
                    onClick={() => checkGitHub(sessionId)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t("common.retry")}
                  </button>
                  <button
                    onClick={close}
                    className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    {t("common.close")}
                  </button>
                </>
              )}

              {/* Posted footer — close */}
              {step === "posted" && (
                <button
                  onClick={close}
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  {t("common.done")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
