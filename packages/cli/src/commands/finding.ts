/**
 * OCR Finding Command
 *
 * The CLI is the only writer of agent-originated changes to findings
 * (verification outcomes, revisions). Each write updates the finding AND
 * appends a revision row in one transaction (see persistence `findings.ts`).
 *
 * Subcommands:
 *   verify --id --status --note [--file]
 *   revise --id --field --value --reason --source [--conversation]
 *   show   --id
 *
 * All subcommands resolve `.ocr/` from the MAIN checkout: inside a linked
 * worktree (e.g. a PR worktree) `cwd/.ocr` belongs to the PR, not to the shared DB.
 *
 * `--json` prints exactly one object:
 *   ok:   { ok: true, finding, revisions }
 *   fail: { ok: false, code, error }   (exit 1)
 */

import { Command } from "commander";
import chalk from "chalk";
import { join } from "node:path";
import { requireOcrSetup } from "../lib/guards.js";
import { resolveMainCheckout } from "../lib/main-checkout.js";
import {
  ensureDatabase,
  FindingError,
  getFinding,
  getFindingRevisions,
  recordVerification,
  reviseFinding,
  type FindingRevisionRow,
  type FindingRow,
  type FindingRevisableField,
  type FindingRevisionSource,
  type FindingVerificationStatus,
} from "@open-code-review/persistence";

export type FindingSuccess = { ok: true; finding: FindingRow; revisions: FindingRevisionRow[] };
export type FindingFailure = {
  ok: false;
  code: FindingError["code"] | "invalid-id" | "failed";
  error: string;
};

// ── Core (pure of process I/O; exercised directly by tests) ──

function parseId(raw: string): number {
  if (!/^\d+$/.test(raw.trim())) throw new FindingError("invalid-value", `Invalid --id "${raw}": expected a positive integer`);
  return Number(raw);
}

async function run(
  projectRoot: string,
  id: string,
  write: (db: Awaited<ReturnType<typeof ensureDatabase>>, findingId: number) => void,
): Promise<FindingSuccess | FindingFailure> {
  try {
    const findingId = parseId(id);
    const db = await ensureDatabase(join(projectRoot, ".ocr"));
    write(db, findingId);
    const finding = getFinding(db, findingId);
    if (!finding) throw new FindingError("not-found", `Finding ${findingId} not found`);
    return { ok: true, finding, revisions: getFindingRevisions(db, findingId) };
  } catch (error) {
    if (error instanceof FindingError) return { ok: false, code: error.code, error: error.message };
    return { ok: false, code: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

export function runVerify(
  projectRoot: string,
  opts: { id: string; status: string; note: string; file?: string },
): Promise<FindingSuccess | FindingFailure> {
  return run(projectRoot, opts.id, (db, findingId) => {
    recordVerification(db, {
      findingId,
      status: opts.status as FindingVerificationStatus,
      note: opts.note,
      file: opts.file,
    });
  });
}

export function runRevise(
  projectRoot: string,
  opts: { id: string; field: string; value: string; reason: string; source: string; conversation?: string },
): Promise<FindingSuccess | FindingFailure> {
  return run(projectRoot, opts.id, (db, findingId) => {
    reviseFinding(db, {
      findingId,
      field: opts.field as FindingRevisableField,
      value: opts.value,
      reason: opts.reason,
      source: opts.source as FindingRevisionSource,
      conversationId: opts.conversation,
    });
  });
}

export function runShow(projectRoot: string, opts: { id: string }): Promise<FindingSuccess | FindingFailure> {
  return run(projectRoot, opts.id, () => {});
}

// ── CLI wiring ──

function emit(result: FindingSuccess | FindingFailure, json: boolean | undefined, summary: string): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(chalk.green(summary));
  } else {
    console.error(chalk.red(`Error (${result.code}): ${result.error}`));
  }
  if (!result.ok) process.exit(1);
}

const verifySubcommand = new Command("verify")
  .description("Record a verification outcome for a finding (writes a revision with source verifier)")
  .requiredOption("--id <n>", "Finding id")
  .requiredOption("--status <status>", "pending | reproduced | supported | dismissed")
  .requiredOption("--note <text>", "Short summary of the verification outcome")
  .option("--file <path>", "Path to the full verification write-up")
  .option("--json", "Output one JSON object")
  .action(async (o: { id: string; status: string; note: string; file?: string; json?: boolean }) => {
    const root = resolveMainCheckout(process.cwd());
    requireOcrSetup(root);
    const r = await runVerify(root, o);
    emit(r, o.json, `Finding ${o.id} verification: ${o.status}`);
  });

const reviseSubcommand = new Command("revise")
  .description("Change a finding's severity or category (writes a revision)")
  .requiredOption("--id <n>", "Finding id")
  .requiredOption("--field <field>", "severity | category")
  .requiredOption("--value <value>", "New value (severity: critical|high|medium|low|info; category: blocker|should_fix|suggestion|style)")
  .requiredOption("--reason <text>", "Why the value changes")
  .requiredOption("--source <source>", "user | chat | verifier")
  .option("--conversation <id>", "Chat conversation id that proposed the change")
  .option("--json", "Output one JSON object")
  .action(
    async (o: { id: string; field: string; value: string; reason: string; source: string; conversation?: string; json?: boolean }) => {
      const root = resolveMainCheckout(process.cwd());
      requireOcrSetup(root);
      const r = await runRevise(root, o);
      emit(r, o.json, `Finding ${o.id} ${o.field} -> ${o.value}`);
    },
  );

const showSubcommand = new Command("show")
  .description("Show a finding with its decision, verification and revisions")
  .requiredOption("--id <n>", "Finding id")
  .option("--json", "Output one JSON object")
  .action(async (o: { id: string; json?: boolean }) => {
    const root = resolveMainCheckout(process.cwd());
    requireOcrSetup(root);
    const r = await runShow(root, o);
    if (!o.json && r.ok) {
      console.log(JSON.stringify({ finding: r.finding, revisions: r.revisions }, null, 2));
      return;
    }
    emit(r, o.json, "");
  });

export const findingCommand = new Command("finding")
  .description("Verify, revise and inspect review findings")
  .addCommand(verifySubcommand)
  .addCommand(reviseSubcommand)
  .addCommand(showSubcommand);
