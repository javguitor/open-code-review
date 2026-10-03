/**
 * OCR Finding Command
 *
 * The CLI is the only writer of agent-originated changes to findings
 * (verification outcomes, revisions). Each write updates the finding AND
 * appends a revision row in one transaction (see persistence `findings.ts`).
 *
 * Subcommands:
 *   verify (--id | --synthesis-id) --status --note [--file]
 *   revise (--id | --synthesis-id) --field --value --reason --source [--conversation]
 *   show   (--id | --synthesis-id)
 *
 * `--id` addresses a reviewer finding, `--synthesis-id` a synthesized finding
 * (the two id spaces collide); exactly one is required.
 *
 * All subcommands resolve `.ocr/` from the MAIN checkout: inside a linked
 * worktree (e.g. a PR worktree) `cwd/.ocr` belongs to the PR, not to the shared DB.
 *
 * `--json` prints exactly one object:
 *   ok:   { ok: true, finding, revisions }   (+ `sources` for --synthesis-id: the merged reviewer findings, original text)
 *   fail: { ok: false, code, error }   (exit 1)
 */

import { Command } from "commander";
import chalk from "chalk";
import { join } from "node:path";
import { requireOcrSetup } from "../lib/guards.js";
import {
  ensureDatabase,
  resolveMainCheckout,
  FindingError,
  getFinding,
  getSources,
  getSubjectRevisions,
  getSynthesisFinding,
  recordSubjectVerification,
  reviseSubject,
  type Database,
  type FindingRevisionRow,
  type FindingSubject,
  type SynthesisFindingRow,
  type SynthesisSourceRow,
  type FindingRow,
  type FindingRevisableField,
  type FindingRevisionSource,
  type FindingVerificationStatus,
} from "@open-code-review/persistence";

export type FindingSuccess = { ok: true; finding: FindingRow; revisions: FindingRevisionRow[] };
/** `show/verify/revise --synthesis-id`: the synthesized finding plus the reviewer findings it merges (original text). */
export type SynthesisFindingSuccess = {
  ok: true;
  finding: SynthesisFindingRow;
  revisions: FindingRevisionRow[];
  sources: SynthesisSourceRow[];
};
export type FindingFailure = {
  ok: false;
  code: FindingError["code"] | "invalid-id" | "usage" | "failed";
  error: string;
};

/** Exactly one of `id` (reviewer finding) and `synthesisId` (synthesized finding); the id spaces collide. */
export type FindingTarget = { id?: string; synthesisId?: string };

// ── Core (pure of process I/O; exercised directly by tests) ──

function parseId(raw: string, flag: string): number {
  if (!/^[1-9]\d*$/.test(raw.trim())) throw new FindingError("invalid-value", `Invalid ${flag} "${raw}": expected a positive integer`);
  return Number(raw);
}

class UsageError extends Error {}

function resolveSubject(target: FindingTarget): FindingSubject {
  const hasId = target.id !== undefined;
  const hasSynthesis = target.synthesisId !== undefined;
  if (hasId === hasSynthesis) throw new UsageError("Pass exactly one of --id <n> or --synthesis-id <n>");
  return hasSynthesis
    ? { kind: "synthesis", id: parseId(target.synthesisId!, "--synthesis-id") }
    : { kind: "reviewer", id: parseId(target.id!, "--id") };
}

async function run(
  projectRoot: string,
  target: FindingTarget,
  write: (db: Database, subject: FindingSubject) => void,
): Promise<FindingSuccess | SynthesisFindingSuccess | FindingFailure> {
  try {
    const subject = resolveSubject(target);
    const db = await ensureDatabase(join(projectRoot, ".ocr"));
    write(db, subject);
    const revisions = getSubjectRevisions(db, subject);
    if (subject.kind === "synthesis") {
      const finding = getSynthesisFinding(db, subject.id);
      if (!finding) throw new FindingError("not-found", `Synthesized finding ${subject.id} not found`);
      return { ok: true, finding, revisions, sources: getSources(db, subject.id) };
    }
    const finding = getFinding(db, subject.id);
    if (!finding) throw new FindingError("not-found", `Finding ${subject.id} not found`);
    return { ok: true, finding, revisions };
  } catch (error) {
    if (error instanceof UsageError) return { ok: false, code: "usage", error: error.message };
    if (error instanceof FindingError) return { ok: false, code: error.code, error: error.message };
    return { ok: false, code: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

export function runVerify(
  projectRoot: string,
  opts: FindingTarget & { status: string; note: string; file?: string },
): Promise<FindingSuccess | SynthesisFindingSuccess | FindingFailure> {
  return run(projectRoot, opts, (db, subject) => {
    recordSubjectVerification(db, subject, {
      status: opts.status as FindingVerificationStatus,
      note: opts.note,
      file: opts.file,
    });
  });
}

export function runRevise(
  projectRoot: string,
  opts: FindingTarget & { field: string; value: string; reason: string; source: string; conversation?: string },
): Promise<FindingSuccess | SynthesisFindingSuccess | FindingFailure> {
  return run(projectRoot, opts, (db, subject) => {
    reviseSubject(db, subject, {
      field: opts.field as FindingRevisableField,
      value: opts.value,
      reason: opts.reason,
      source: opts.source as FindingRevisionSource,
      conversationId: opts.conversation,
    });
  });
}

export function runShow(
  projectRoot: string,
  opts: FindingTarget,
): Promise<FindingSuccess | SynthesisFindingSuccess | FindingFailure> {
  return run(projectRoot, opts, () => {});
}

// ── CLI wiring ──

function emit(result: FindingSuccess | SynthesisFindingSuccess | FindingFailure, json: boolean | undefined, summary: string): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(chalk.green(summary));
  } else {
    console.error(chalk.red(`Error (${result.code}): ${result.error}`));
  }
  if (!result.ok) process.exit(1);
}

const ID_HELP = "Reviewer finding id (exactly one of --id / --synthesis-id)";
const SYNTHESIS_ID_HELP = "Synthesized finding id (exactly one of --id / --synthesis-id)";

type TargetOpts = { id?: string; synthesisId?: string; json?: boolean };

const describeTarget = (o: TargetOpts): string =>
  o.synthesisId !== undefined ? `Synthesized finding ${o.synthesisId}` : `Finding ${o.id}`;

const verifySubcommand = new Command("verify")
  .description("Record a verification outcome for a finding (writes a revision with source verifier)")
  .option("--id <n>", ID_HELP)
  .option("--synthesis-id <n>", SYNTHESIS_ID_HELP)
  .requiredOption("--status <status>", "pending | reproduced | supported | dismissed")
  .requiredOption("--note <text>", "Short summary of the verification outcome")
  .option("--file <path>", "Path to the full verification write-up")
  .option("--json", "Output one JSON object")
  .action(async (o: TargetOpts & { status: string; note: string; file?: string }) => {
    const root = resolveMainCheckout(process.cwd());
    requireOcrSetup(root);
    const r = await runVerify(root, o);
    emit(r, o.json, `${describeTarget(o)} verification: ${o.status}`);
  });

const reviseSubcommand = new Command("revise")
  .description("Change a finding's severity or category (writes a revision)")
  .option("--id <n>", ID_HELP)
  .option("--synthesis-id <n>", SYNTHESIS_ID_HELP)
  .requiredOption("--field <field>", "severity | category")
  .requiredOption("--value <value>", "New value (severity: critical|high|medium|low|info; category: blocker|should_fix|suggestion|style)")
  .requiredOption("--reason <text>", "Why the value changes")
  .requiredOption("--source <source>", "user | chat | verifier")
  .option("--conversation <id>", "Chat conversation id that proposed the change")
  .option("--json", "Output one JSON object")
  .action(
    async (o: TargetOpts & { field: string; value: string; reason: string; source: string; conversation?: string }) => {
      const root = resolveMainCheckout(process.cwd());
      requireOcrSetup(root);
      const r = await runRevise(root, o);
      emit(r, o.json, `${describeTarget(o)} ${o.field} -> ${o.value}`);
    },
  );

const showSubcommand = new Command("show")
  .description("Show a finding with its decision, verification and revisions (synthesized: plus its sources)")
  .option("--id <n>", ID_HELP)
  .option("--synthesis-id <n>", SYNTHESIS_ID_HELP)
  .option("--json", "Output one JSON object")
  .action(async (o: TargetOpts) => {
    const root = resolveMainCheckout(process.cwd());
    requireOcrSetup(root);
    const r = await runShow(root, o);
    if (!o.json && r.ok) {
      const { ok: _ok, ...body } = r;
      console.log(JSON.stringify(body, null, 2));
      return;
    }
    emit(r, o.json, "");
  });

export const findingCommand = new Command("finding")
  .description("Verify, revise and inspect review findings")
  .addCommand(verifySubcommand)
  .addCommand(reviseSubcommand)
  .addCommand(showSubcommand);
