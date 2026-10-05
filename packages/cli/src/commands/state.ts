/**
 * OCR State Command
 *
 * Manages workflow session state exclusively through SQLite. The atomic
 * porcelain verbs are the only supported API (v2 direct cutover — the
 * legacy init/transition/close/round-complete/map-complete subcommands were
 * removed; their underlying functions remain internal building blocks).
 *
 * Subcommands:
 *   begin          — Start or resume a workflow and report where it stands
 *   advance        — Advance to a phase (graph-validated, phase number derived)
 *   complete-round — Atomically finalize a review round
 *   complete-map   — Atomically finalize a map run
 *   finish         — Close a workflow (invariant-checked)
 *   status         — Report completeness + the next action
 *   show           — Display current session state
 *   sync           — Rebuild session state from filesystem artifacts
 *   reconcile      — Heal legacy/drifted session state
 *   delete         — Permanently delete a closed session (directory + rows)
 */

import { Command, InvalidArgumentError } from "commander";
import chalk from "chalk";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { requireOcrSetup } from "../lib/guards.js";
import { isValidPrNumber } from "../lib/pr-number.js";
import { getWorktreeConfig } from "@open-code-review/config/worktree-config";
import { removePrWorktree } from "./worktree.js";
import {
  stateClose,
  stateShow,
  stateSync,
  stateBegin,
  stateAdvance,
  stateCompleteRound,
  stateCompleteMap,
  stateStatus,
  resolveActiveSession,
  StateError,
  STATE_EXIT,
} from "@open-code-review/persistence/state";
import type { WorkflowType } from "@open-code-review/persistence/state";
import { replayCommandLog } from "@open-code-review/persistence";
import { ensureDatabase, reconcileLegacyState } from "@open-code-review/persistence";
import {
  getForwardResumeMaxAttempts,
  getAgentHeartbeatSeconds,
} from "@open-code-review/config/runtime-config";
import {
  getDb,
  getSession,
  getAllSessions,
  isBusyError,
  linkDashboardInvocationToWorkflow,
  dbPathFor,
  snapshotDb,
  deleteSessionRows,
  countSessionRows,
  hasInFlightDependents,
  runningExecutionForPr,
} from "@open-code-review/persistence";

// ── Helpers ──

/**
 * Spawn-marker shape — written by the dashboard's command-runner at the
 * moment it spawns an AI workflow, read here by `state begin` to bind
 * `workflow_id` on the dashboard's parent `command_executions` row.
 *
 * The marker is the durable answer to a fragile-by-construction problem:
 * env vars get stripped, prompt instructions get ignored, watcher hooks
 * miss UPDATE paths. The marker is filesystem state both processes
 * deterministically share.
 */
type DashboardSpawnMarker = {
  execution_uid: string;
  pid: number;
  started_at: string;
};

/**
 * Parse + liveness-check one marker file. Returns null on unreadable
 * file, malformed JSON, missing fields, or a dead PID.
 *
 * Liveness check: a stale marker (dashboard crashed mid-spawn) must not
 * be consumed. `process.kill(pid, 0)` throws ESRCH when the PID is gone —
 * we treat that as "no live dashboard" and ignore the marker. This
 * prevents a crashed dashboard's leftover marker from mis-linking a
 * future CLI-only `state begin` invocation.
 */
function readMarkerFile(path: string): DashboardSpawnMarker | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as Record<string, unknown>).execution_uid !== "string" ||
    typeof (parsed as Record<string, unknown>).pid !== "number"
  ) {
    return null;
  }
  const marker = parsed as DashboardSpawnMarker;
  try {
    process.kill(marker.pid, 0);
  } catch {
    return null;
  }
  return marker;
}

/**
 * Resolve the dashboard spawn marker for fallback linkage.
 *
 * Per-execution markers live in `data/dashboard-active-spawn/{uid}.json`
 * (round-1 S25 — replaces the former single last-write-wins file). The
 * fallback only makes sense when there is a SINGLE live spawn: if exactly
 * one live marker exists, consume it; if several do, decline to guess
 * (the concurrent-review case — the AI is expected to pass the explicit
 * `--dashboard-uid` flag the spawn prompt mandates, so guessing here
 * would risk a silent mislink). Falls back to the legacy single-file
 * marker when the directory yields nothing (dashboard mid-upgrade).
 *
 * Exported for unit testing of the resolution policy (round-1 S25).
 */
export function readDashboardSpawnMarker(ocrDir: string): DashboardSpawnMarker | null {
  const dir = join(ocrDir, "data", "dashboard-active-spawn");
  let entries: string[] = [];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    entries = [];
  }
  const live: DashboardSpawnMarker[] = [];
  for (const entry of entries) {
    const marker = readMarkerFile(join(dir, entry));
    if (marker) live.push(marker);
  }
  if (live.length === 1) return live[0] ?? null;
  if (live.length > 1) {
    // Ambiguous: more than one concurrent spawn is live. Refuse to guess —
    // an explicit `--dashboard-uid` flag is the unambiguous linkage path.
    console.error(
      chalk.gray(
        `[state] ${live.length} concurrent dashboard spawns live; marker fallback is ambiguous — pass --dashboard-uid for linkage`,
      ),
    );
    return null;
  }
  // No per-execution markers — fall back to the legacy single-file marker
  // for compatibility with a dashboard that predates per-execution markers.
  return readMarkerFile(join(ocrDir, "data", "dashboard-active-spawn.json"));
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const data = Buffer.concat(chunks).toString("utf-8").trim();
  if (data.length === 0) {
    throw new Error("No data received on stdin");
  }
  return data;
}

/**
 * Late-link the dashboard's parent `command_executions` row to a freshly
 * created session so the dashboard can bind outcome + offer a resume command.
 *
 * Resolves the dashboard uid by reliability: `--dashboard-uid` flag →
 * `OCR_DASHBOARD_EXECUTION_UID` env var → filesystem spawn marker. Non-fatal:
 * the session is created either way; only resume discoverability suffers.
 *
 * Called by `begin` (the v2 create/resume verb) after the session row exists.
 */
async function linkDashboardInvocation(
  ocrDir: string,
  sessionId: string,
  explicitUid: string | undefined,
  label: string,
): Promise<void> {
  const markerUid = readDashboardSpawnMarker(ocrDir)?.execution_uid;
  const dashboardUid =
    explicitUid ?? process.env["OCR_DASHBOARD_EXECUTION_UID"] ?? markerUid;
  if (!dashboardUid) {
    console.error(
      chalk.gray(
        `[state ${label}] no dashboard linkage available (flag, env var, and marker file all absent — CLI-only invocation)`,
      ),
    );
    return;
  }
  try {
    const db = await getDb(ocrDir);
    linkDashboardInvocationToWorkflow(db, dashboardUid, sessionId);
    console.error(
      chalk.gray(
        `[state ${label}] linked workflow_id=${sessionId} → dashboard uid=${dashboardUid}`,
      ),
    );
  } catch (linkErr) {
    console.error(
      chalk.yellow(
        `Warning: failed to link dashboard command_execution to session: ${
          linkErr instanceof Error ? linkErr.message : String(linkErr)
        }`,
      ),
    );
  }
}

// ── show ──

const showSubcommand = new Command("show")
  .description("Show current session state")
  .option("--session-id <id>", "Session ID (defaults to latest active)")
  .option("--json", "Output as JSON")
  .action(async (options: { sessionId?: string; json?: boolean }) => {
    const targetDir = process.cwd();
    requireOcrSetup(targetDir);
    const ocrDir = join(targetDir, ".ocr");

    try {
      const result = await stateShow(ocrDir, options.sessionId);

      if (!result) {
        if (options.json) {
          console.log(JSON.stringify(null));
        } else {
          console.log(chalk.dim("No active session found."));
        }
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const s = result.session;
      console.log();
      console.log(
        chalk.bold(`Session: ${s.id}`) +
          chalk.dim(` (${s.status})`),
      );
      console.log(
        chalk.dim("  Branch:    ") + chalk.white(s.branch),
      );
      console.log(
        chalk.dim("  Workflow:  ") + chalk.white(s.workflow_type),
      );
      console.log(
        chalk.dim("  Phase:     ") +
          chalk.cyan(s.current_phase) +
          chalk.dim(` (${s.phase_number})`),
      );
      if (s.workflow_type === "review") {
        console.log(
          chalk.dim("  Round:     ") + chalk.white(String(s.current_round)),
        );
      }
      if (s.workflow_type === "map") {
        console.log(
          chalk.dim("  Map Run:   ") + chalk.white(String(s.current_map_run)),
        );
      }
      const refRows: Array<[string, string | number | null]> = [
        ["Base ref:  ", s.base_ref],
        ["Head ref:  ", s.head_ref],
        ["Head SHA:  ", s.head_sha],
        ["PR:        ", s.pr_number],
        ["PR URL:    ", s.pr_url],
        ["PR author: ", s.pr_author],
        ["Reqs URL:  ", s.requirements_source_url],
        ["Reqs date: ", s.requirements_updated_at],
      ];
      for (const [label, value] of refRows) {
        if (value !== null) {
          console.log(chalk.dim(`  ${label}`) + chalk.white(String(value)));
        }
      }
      console.log(
        chalk.dim("  Started:   ") + chalk.white(s.started_at),
      );
      console.log(
        chalk.dim("  Updated:   ") + chalk.white(s.updated_at),
      );

      if (result.events.length > 0) {
        console.log();
        console.log(chalk.dim("  Recent events:"));
        const recentEvents = result.events.slice(-5);
        for (const event of recentEvents) {
          const phaseInfo = event.phase ? chalk.dim(` [${event.phase}]`) : "";
          console.log(
            chalk.dim("    ") +
              chalk.white(event.event_type) +
              phaseInfo +
              chalk.dim(` at ${event.created_at}`),
          );
        }
      }
      console.log();
    } catch (error) {
      console.error(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : "Failed to show state"}`,
        ),
      );
      process.exit(1);
    }
  });

// ── sync ──

const syncSubcommand = new Command("sync")
  .description("Rebuild session state from filesystem artifacts")
  .action(async () => {
    const targetDir = process.cwd();
    requireOcrSetup(targetDir);
    const ocrDir = join(targetDir, ".ocr");

    try {
      const synced = await stateSync(ocrDir);
      console.log(`Synced ${synced} session${synced !== 1 ? "s" : ""} from filesystem.`);

      // Recover command history from JSONL backup if DB was recreated
      const db = await getDb(ocrDir);
      const countResult = db.exec("SELECT COUNT(*) as c FROM command_executions");
      const totalCmds = (countResult[0]?.values[0]?.[0] as number) ?? 0;
      if (totalCmds === 0) {
        const recovered = replayCommandLog(db, ocrDir);
        if (recovered > 0) {
          console.log(`Recovered ${recovered} command${recovered !== 1 ? "s" : ""} from backup log.`);
        }
      }
    } catch (error) {
      console.error(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : "Failed to sync"}`,
        ),
      );
      process.exit(1);
    }
  });

// ── reconcile ──

const reconcileSubcommand = new Command("reconcile")
  .description(
    "Heal legacy/drifted session state by deriving truth from events + artifacts",
  )
  .option("--dry-run", "Print the repair plan without writing anything")
  .option("--json", "Output the result as JSON")
  .action(async (options: { dryRun?: boolean; json?: boolean }) => {
    const targetDir = process.cwd();
    requireOcrSetup(targetDir);
    const ocrDir = join(targetDir, ".ocr");

    try {
      const db = await ensureDatabase(ocrDir);
      const result = reconcileLegacyState(db, ocrDir, { dryRun: options.dryRun });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const repairs = result.actions.filter((a) => a.kind !== "ok");
      if (repairs.length === 0) {
        console.log(chalk.dim("Nothing to reconcile — all sessions consistent."));
        return;
      }
      console.log(
        result.dryRun
          ? chalk.bold(`Reconciliation plan (${repairs.length} change(s), dry run):`)
          : chalk.bold(`Reconciled ${repairs.length} session(s):`),
      );
      for (const a of repairs) {
        console.log(`  ${chalk.cyan(a.kind)}  ${a.sessionId}`);
        console.log(`    ${chalk.dim(a.detail)}`);
      }
    } catch (error) {
      console.error(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : "Failed to reconcile"}`,
        ),
      );
      process.exit(1);
    }
  });

// ── delete ──

export type DeleteSessionOutcome = {
  status: "deleted" | "already-absent" | "refused" | "error";
  session_id: string;
  code?: "not-closed" | "in-flight" | "outside-root";
  error?: string;
  dry_run?: boolean;
  /** Dry run: what would be removed. Otherwise: what was. */
  removed?: { directory: boolean; rows: Record<string, number>; files: number };
  worktree: null | { status: string; error?: string };
};

/** True iff `dir` is strictly inside `root` (never `root` itself). */
function isStrictlyInside(root: string, dir: string): boolean {
  const rel = relative(root, dir);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Unlink each file that exists; returns how many were removed. Best-effort. */
function unlinkExisting(paths: string[]): number {
  let removed = 0;
  for (const path of paths) {
    try {
      if (!existsSync(path)) continue;
      unlinkSync(path);
      removed++;
    } catch {
      // best-effort: a leftover log file is harmless
    }
  }
  return removed;
}

/**
 * Delete a closed session: directory FIRST, then rows. With the directory gone
 * nothing can backfill the row (FilesystemSync only backfills directories that
 * exist); the reverse order resurrects the session on the next sync. Every step
 * is a no-op when its target is already gone, so a re-run converges.
 */
export async function deleteSession(
  ocrDir: string,
  sessionId: string,
  options: { removeWorktree?: boolean; dryRun?: boolean },
): Promise<DeleteSessionOutcome> {
  const db = await ensureDatabase(ocrDir);
  const row = getSession(db, sessionId);
  const sessionsRoot = resolve(ocrDir, "sessions");
  const dir = resolve(
    row?.session_dir
      ? isAbsolute(row.session_dir) ? row.session_dir : join(dirname(ocrDir), row.session_dir)
      : join(sessionsRoot, sessionId),
  );
  const refuse = (code: NonNullable<DeleteSessionOutcome["code"]>): DeleteSessionOutcome => ({
    status: "refused",
    session_id: sessionId,
    code,
    worktree: null,
  });

  // `SESSION_ID_PATTERN` allows `/` and `..`, so the id alone is no guard for a recursive delete.
  if (!isStrictlyInside(sessionsRoot, dir)) return refuse("outside-root");
  const dirExists = existsSync(dir);
  if (!row && !dirExists) return { status: "already-absent", session_id: sessionId, worktree: null };

  // Guards protect a session's lifecycle; a directory without a row has none.
  if (row) {
    if (row.status !== "closed") return refuse("not-closed");
    if (
      hasInFlightDependents(db, sessionId) ||
      (row.pr_number != null && runningExecutionForPr(db, row.pr_number) !== null)
    ) {
      return refuse("in-flight");
    }
  }

  const prNumber = row?.pr_number ?? null;
  const sharedPr =
    prNumber != null &&
    db.exec("SELECT 1 FROM sessions WHERE pr_number = ? AND id != ? LIMIT 1", [prNumber, sessionId])[0]
      ?.values.length === 1;
  const worktreeSkip = !options.removeWorktree
    ? null
    : prNumber == null
      ? { status: "skipped-no-pr" }
      : sharedPr
        ? { status: "skipped-shared" }
        : undefined;

  if (options.dryRun) {
    return {
      status: "deleted",
      session_id: sessionId,
      dry_run: true,
      removed: { directory: dirExists, rows: row ? countSessionRows(db, sessionId) : {}, files: 0 },
      worktree: worktreeSkip === undefined ? { status: "would-remove" } : worktreeSkip,
    };
  }

  if (row) snapshotDb(db, dbPathFor(ocrDir), "delete-session");
  if (dirExists) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      return {
        status: "error",
        session_id: sessionId,
        error: error instanceof Error ? error.message : String(error),
        worktree: null,
      };
    }
  }

  let rows: Record<string, number> = {};
  let files = 0;
  if (row) {
    const deleted = deleteSessionRows(db, sessionId);
    rows = deleted.rows;
    files = unlinkExisting([
      ...deleted.executionUids.map((uid) => join(ocrDir, "data", "exec-logs", `${uid}.log`)),
      ...deleted.executionIds.map((id) => join(ocrDir, "data", "events", `${id}.jsonl`)),
    ]);
  }

  let worktree: DeleteSessionOutcome["worktree"] = worktreeSkip ?? null;
  if (worktreeSkip === undefined && prNumber != null) {
    // Never undoes the delete: any failure is reported, not thrown.
    try {
      worktree = { status: removePrWorktree({ ocrDir, prNumber }).status };
    } catch (error) {
      worktree = { status: "error", error: error instanceof Error ? error.message : String(error) };
    }
  }
  return {
    status: "deleted",
    session_id: sessionId,
    removed: { directory: dirExists, rows, files },
    worktree,
  };
}

const deleteSubcommand = new Command("delete")
  .description("Permanently delete a closed session: its directory and all of its database rows")
  .argument("<session-id>", "Session ID to delete")
  .option("--remove-worktree", "Also remove the session's PR worktree (never forced; kept if shared, dirty or in use)")
  .option("--dry-run", "Print what would be deleted without writing anything")
  .option("--json", "Output the result as JSON")
  .action(
    async (
      sessionId: string,
      options: { removeWorktree?: boolean; dryRun?: boolean; json?: boolean },
    ) => {
      const targetDir = process.cwd();
      requireOcrSetup(targetDir);
      const ocrDir = join(targetDir, ".ocr");

      let outcome: DeleteSessionOutcome;
      try {
        outcome = await deleteSession(ocrDir, sessionId, options);
      } catch (error) {
        exitFromStateError(error, "Failed to delete session");
      }

      if (options.json) {
        console.log(JSON.stringify(outcome, null, 2));
      } else {
        printDeleteOutcome(outcome);
      }
      if (outcome.status === "refused") process.exit(STATE_EXIT.INVARIANT_UNMET);
      if (outcome.status === "error") process.exit(1);
    },
  );

function printDeleteOutcome(o: DeleteSessionOutcome): void {
  if (o.status === "already-absent") {
    console.log(chalk.dim(`${o.session_id}: already absent`));
  } else if (o.status === "refused") {
    console.error(chalk.red(`${o.session_id}: refused (${o.code}) — nothing deleted`));
  } else if (o.status === "error") {
    console.error(chalk.red(`${o.session_id}: could not remove the session directory: ${o.error}`));
  } else {
    const verb = o.dry_run ? "would delete" : "deleted";
    const rows = Object.values(o.removed?.rows ?? {}).reduce((a, b) => a + b, 0);
    console.log(`${o.session_id}: ${verb}${o.removed?.directory ? " directory" : ""}, ${rows} row(s)`);
    if (o.dry_run) {
      for (const [table, n] of Object.entries(o.removed?.rows ?? {})) {
        if (n > 0) console.log(chalk.dim(`  ${table}: ${n}`));
      }
    }
  }
  if (o.worktree) {
    const detail = o.worktree.error ? `: ${o.worktree.error}` : "";
    console.log(chalk.dim(`  worktree: ${o.worktree.status}${detail}`));
  }
}

// ── Atomic porcelain (the misuse-proof agent API) ──

/** Map a thrown error to its exit code + message, then exit. */
function exitFromStateError(error: unknown, fallback: string): never {
  if (error instanceof StateError) {
    console.error(chalk.red(`Error: ${error.message}`));
    process.exit(error.code);
  }
  // A SQLITE_BUSY that survived the engine's bounded retry surfaces as a
  // distinct exit code so an orchestrator can back off and retry rather than
  // treat it as a permanent failure.
  if (isBusyError(error)) {
    console.error(
      chalk.red(
        `Error: database is busy (locked past retry budget): ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    );
    process.exit(STATE_EXIT.BUSY);
  }
  console.error(
    chalk.red(`Error: ${error instanceof Error ? error.message : fallback}`),
  );
  process.exit(1);
}

const beginSubcommand = new Command("begin")
  .description("Start or resume a workflow and report where it stands")
  .requiredOption("--session-id <id>", "Session ID")
  .requiredOption("--branch <branch>", "Branch name")
  .requiredOption("--workflow-type <type>", "Workflow type (review or map)", (v: string) => {
    if (v !== "review" && v !== "map") {
      throw new Error(`Invalid workflow type: "${v}". Must be "review" or "map".`);
    }
    return v as WorkflowType;
  })
  .option("--session-dir <dir>", "Session directory path (auto-resolved if omitted)")
  .option(
    "--dashboard-uid <uid>",
    "Dashboard command_executions uid to link this workflow to (takes precedence over OCR_DASHBOARD_EXECUTION_UID)",
  )
  .option("--base-ref <ref>", "Base ref of the reviewed change (e.g. origin/main)")
  .option("--head-ref <ref>", "Local ref that was reviewed (e.g. refs/ocr/pr/<n>)")
  .option("--head-sha <sha>", "Commit SHA being reviewed")
  .option("--pr-number <n>", "Pull request number (positive integer)", (v: string) => {
    if (!isValidPrNumber(v)) {
      throw new InvalidArgumentError(`Invalid PR number: "${v}". Must be a positive integer.`);
    }
    return Number(v);
  })
  .option("--pr-url <url>", "Pull request URL")
  .option("--pr-author <login>", "GitHub login of the pull request author")
  .option("--requirements-url <url>", "URL of the requirements source (ClickUp card, issue, ...)")
  .option("--requirements-updated-at <iso>", "Provider's last-updated timestamp of the requirements source")
  .option("--json", "Output the result as JSON")
  .action(
    async (options: {
      sessionId: string;
      branch: string;
      workflowType: WorkflowType;
      sessionDir?: string;
      requirementsUrl?: string;
      requirementsUpdatedAt?: string;
      baseRef?: string;
      headRef?: string;
      headSha?: string;
      prNumber?: number;
      prUrl?: string;
      prAuthor?: string;
      dashboardUid?: string;
      json?: boolean;
    }) => {
      const targetDir = process.cwd();
      requireOcrSetup(targetDir);
      const ocrDir = join(targetDir, ".ocr");
      const sessionDir =
        options.sessionDir ?? join(ocrDir, "sessions", options.sessionId);
      if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
      try {
        const result = await stateBegin({
          sessionId: options.sessionId,
          branch: options.branch,
          workflowType: options.workflowType,
          sessionDir,
          ocrDir,
          baseRef: options.baseRef,
          headRef: options.headRef,
          headSha: options.headSha,
          prNumber: options.prNumber,
          prUrl: options.prUrl,
          prAuthor: options.prAuthor,
          requirementsUrl: options.requirementsUrl,
          requirementsUpdatedAt: options.requirementsUpdatedAt,
        });
        // Superset of `init`: wire up dashboard linkage so the dashboard can
        // bind outcome + offer resume.
        await linkDashboardInvocation(ocrDir, result.session_id, options.dashboardUid, "begin");
        console.log(
          options.json
            ? JSON.stringify(result, null, 2)
            : `${result.session_id}: round ${result.round}, phase ${result.phase} (${result.completeness ?? "unknown"})`,
        );
      } catch (error) {
        exitFromStateError(error, "Failed to begin session");
      }
    },
  );

const advanceSubcommand = new Command("advance")
  .description("Advance the workflow to a phase (graph-validated; phase number derived)")
  .requiredOption("--phase <phase>", "Target phase name")
  .option("--session-id <id>", "Session ID (auto-detects active if omitted)")
  .option("--current-round <number>", "Round number", parseInt)
  .option("--current-map-run <number>", "Map run number", parseInt)
  // Accepted but ignored — the phase number is DERIVED from the phase, so it
  // can never desync. Tolerated so the `transition`-era flag remains valid.
  .option("--phase-number <number>", "(ignored — derived from --phase)", parseInt)
  .action(
    async (options: {
      phase: string;
      sessionId?: string;
      currentRound?: number;
      currentMapRun?: number;
      phaseNumber?: number;
    }) => {
      const targetDir = process.cwd();
      requireOcrSetup(targetDir);
      const ocrDir = join(targetDir, ".ocr");
      try {
        const { id: sessionId } = await resolveActiveSession(ocrDir, options.sessionId);
        await stateAdvance({
          sessionId,
          phase: options.phase,
          round: options.currentRound,
          mapRun: options.currentMapRun,
          ocrDir,
        });
        console.log(`${sessionId}: ${options.phase}`);
      } catch (error) {
        exitFromStateError(error, "Failed to advance");
      }
    },
  );

const completeRoundSubcommand = new Command("complete-round")
  .description("Atomically finalize a review round (validate + record + transition)")
  .option("--session-id <id>", "Session ID (auto-detects active if omitted)")
  .option("--round <number>", "Round number (defaults to current)", parseInt)
  .option("--stdin", "Read round metadata JSON from stdin")
  .option("--file <path>", "Read round metadata JSON from a file")
  .option("--require-final", "Require rounds/round-N/final.md to exist")
  .option("--json", "Output the result as JSON")
  .action(
    async (options: {
      sessionId?: string;
      round?: number;
      stdin?: boolean;
      file?: string;
      requireFinal?: boolean;
      json?: boolean;
    }) => {
      const targetDir = process.cwd();
      requireOcrSetup(targetDir);
      const ocrDir = join(targetDir, ".ocr");
      try {
        const base = options.stdin
          ? { source: "stdin" as const, data: await readStdin() }
          : options.file
            ? { source: "file" as const, filePath: options.file }
            : (() => {
                throw new StateError(STATE_EXIT.USAGE, "Provide --stdin or --file with round metadata");
              })();
        const result = await stateCompleteRound({
          ...base,
          ocrDir,
          sessionId: options.sessionId,
          round: options.round,
          requireFinal: options.requireFinal,
        });
        console.log(
          options.json
            ? JSON.stringify(result, null, 2)
            : `${result.sessionId}: round ${result.round} complete`,
        );
      } catch (error) {
        exitFromStateError(error, "Failed to complete round");
      }
    },
  );

const completeMapSubcommand = new Command("complete-map")
  .description("Atomically finalize a map run (validate + record + transition)")
  .option("--session-id <id>", "Session ID (auto-detects active if omitted)")
  .option("--map-run <number>", "Map run number (defaults to current)", parseInt)
  .option("--stdin", "Read map metadata JSON from stdin")
  .option("--file <path>", "Read map metadata JSON from a file")
  .option("--json", "Output the result as JSON")
  .action(
    async (options: {
      sessionId?: string;
      mapRun?: number;
      stdin?: boolean;
      file?: string;
      json?: boolean;
    }) => {
      const targetDir = process.cwd();
      requireOcrSetup(targetDir);
      const ocrDir = join(targetDir, ".ocr");
      try {
        const base = options.stdin
          ? { source: "stdin" as const, data: await readStdin() }
          : options.file
            ? { source: "file" as const, filePath: options.file }
            : (() => {
                throw new StateError(STATE_EXIT.USAGE, "Provide --stdin or --file with map metadata");
              })();
        const result = await stateCompleteMap({
          ...base,
          ocrDir,
          sessionId: options.sessionId,
          mapRun: options.mapRun,
        });
        console.log(
          options.json
            ? JSON.stringify(result, null, 2)
            : `${result.sessionId}: map run ${result.mapRun} complete`,
        );
      } catch (error) {
        exitFromStateError(error, "Failed to complete map");
      }
    },
  );

/**
 * `worktrees.cleanup: on-close` — drop the PR worktree once its last active
 * session is closed. Best effort: a dirty/missing worktree or a git failure
 * prints a notice and never fails the finish (the session is already closed).
 */
export async function cleanupPrWorktree(ocrDir: string, sessionId: string): Promise<void> {
  try {
    if (getWorktreeConfig(ocrDir).cleanup !== "on-close") return;
    const db = await getDb(ocrDir);
    const prNumber = getSession(db, sessionId)?.pr_number;
    if (prNumber == null) return;
    if (getAllSessions(db).some((s) => s.status === "active" && s.pr_number === prNumber)) return;
    const result = removePrWorktree({ ocrDir, prNumber });
    if (result.status === "removed") {
      console.log(chalk.dim(`Removed worktree ${result.path}`));
    } else if (result.status === "dirty") {
      console.log(chalk.dim(`Worktree ${result.path} has uncommitted changes; kept (ocr worktree remove ${prNumber} --force)`));
    } else {
      console.log(chalk.dim(`No worktree for PR #${prNumber}; nothing to clean up`));
    }
  } catch (error) {
    console.log(chalk.dim(`Worktree cleanup skipped: ${error instanceof Error ? error.message : String(error)}`));
  }
}

const finishSubcommand = new Command("finish")
  .description("Close a workflow (refuses unless the current round/run is complete)")
  .option("--session-id <id>", "Session ID (auto-detects active if omitted)")
  .option("--abort", "Abandon the session — records a distinct, non-success terminal")
  .action(async (options: { sessionId?: string; abort?: boolean }) => {
    const targetDir = process.cwd();
    requireOcrSetup(targetDir);
    const ocrDir = join(targetDir, ".ocr");
    try {
      const { id: sessionId } = await resolveActiveSession(ocrDir, options.sessionId);
      await stateClose({ sessionId, ocrDir, abort: options.abort });
      console.log(`${sessionId}: ${options.abort ? "aborted" : "finished"}`);
      await cleanupPrWorktree(ocrDir, sessionId);
    } catch (error) {
      exitFromStateError(error, "Failed to finish");
    }
  });

const statusSubcommand = new Command("status")
  .description("Report whether a session is complete and, if not, what's missing")
  .option("--session-id <id>", "Session ID (auto-detects active if omitted)")
  .option("--json", "Output the result as JSON")
  .action(async (options: { sessionId?: string; json?: boolean }) => {
    const targetDir = process.cwd();
    requireOcrSetup(targetDir);
    const ocrDir = join(targetDir, ".ocr");
    try {
      // Pass the forward-resume config so a stranded mid-pipeline run (incomplete
      // + owning turn dead) is classified `forward_resume` / `abort_or_fresh`
      // with its remaining phases and attempts left.
      const result = await stateStatus(ocrDir, options.sessionId, {
        maxAttempts: getForwardResumeMaxAttempts(ocrDir),
        heartbeatMs: getAgentHeartbeatSeconds(ocrDir) * 1000,
      });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`${result.session_id}: ${result.completeness_state}`);
        console.log(chalk.dim(`  next: ${result.next_action}`));
        if (result.remaining_phases?.length) {
          console.log(chalk.dim(`  remaining: ${result.remaining_phases.join(" → ")}`));
        }
      }
    } catch (error) {
      exitFromStateError(error, "Failed to read status");
    }
  });

// ── Main state command ──

/** The verbs v2.0 retired, mapped to their atomic replacements. */
const RETIRED_STATE_VERBS: Record<string, string> = {
  init: "begin",
  transition: "advance",
  "round-complete": "complete-round",
  "map-complete": "complete-map",
  close: "finish",
};

export const stateCommand = new Command("state")
  .description("Manage OCR session state")
  // Atomic porcelain — the only supported agent API.
  .addCommand(beginSubcommand)
  .addCommand(advanceSubcommand)
  .addCommand(completeRoundSubcommand)
  .addCommand(completeMapSubcommand)
  .addCommand(finishSubcommand)
  .addCommand(statusSubcommand)
  // Read/maintenance verbs.
  .addCommand(showSubcommand)
  .addCommand(syncSubcommand)
  .addCommand(reconcileSubcommand)
  .addCommand(deleteSubcommand)
  // Commander's default unknown-subcommand path exits 1 with a misleading
  // "Did you mean finish?" guess. For a CLI whose consumer is an LLM, give a
  // deterministic typed signal instead: exit 2 (USAGE) routing a v1-pinned
  // agent to the atomic verb it should use.
  .showSuggestionAfterError(false)
  .on("command:*", (operands: string[]) => {
    const verb = operands[0] ?? "";
    const replacement = RETIRED_STATE_VERBS[verb];
    const msg = replacement
      ? `'ocr state ${verb}' was retired in v2.0 — use 'ocr state ${replacement}'. See 'ocr state --help'.`
      : `Unknown 'ocr state' subcommand: '${verb}'. See 'ocr state --help'.`;
    exitFromStateError(new StateError(STATE_EXIT.USAGE, msg), msg);
  });
