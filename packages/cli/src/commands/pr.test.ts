import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { ensureDatabase, insertSession, updateSession } from "@open-code-review/persistence";
import { makeTempWorkspace, removeTempWorkspace } from "@open-code-review/persistence/test-support";
import { runPriorFeedback } from "./pr.js";

let root: string;
let sessionDir: string;

const PR_URL = "https://github.com/acme/app/pull/7";
const now = () => new Date("2026-03-01T00:00:00Z");

type Conn = "reviewThreads" | "reviews" | "comments";
const page = (conn: Conn, nodes: unknown[], next: string | null = null): string =>
  JSON.stringify({
    data: { repository: { pullRequest: { [conn]: { pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes } } } },
  });

const thread = (over: Record<string, unknown> = {}) => ({
  isResolved: false,
  isOutdated: false,
  path: "src/a.ts",
  line: 10,
  originalLine: 8,
  comments: { nodes: [{ url: "https://github.com/acme/app/pull/7#discussion_r1", body: "fix this", author: { login: "ana", __typename: "User" } }] },
  ...over,
});

/** Scripted gh: answers by connection name found in the query argument; `pages` are consumed in order. */
function scriptedGh(pages: Partial<Record<Conn, string[]>>) {
  const queues = Object.fromEntries(Object.entries(pages).map(([k, v]) => [k, [...v!]]));
  return vi.fn(async (args: string[]) => {
    const query = args.find((a) => a.startsWith("query=")) ?? "";
    const conn = (["reviewThreads", "reviews", "comments"] as const).find((c) => query.includes(`${c}(first:100`))!;
    const next = queues[conn]?.shift();
    return next ?? page(conn, []);
  });
}

beforeEach(async () => {
  root = realpathSync(makeTempWorkspace("ocr-pr-"));
  sessionDir = join(root, ".ocr", "sessions", "s1");
  mkdirSync(sessionDir, { recursive: true });
  const db = await ensureDatabase(join(root, ".ocr"));
  insertSession(db, { id: "s1", branch: "b", workflow_type: "review", session_dir: sessionDir, pr_number: 7, pr_url: PR_URL });
  updateSession(db, "s1", { current_round: 2 });
});

afterEach(() => removeTempWorkspace(root));

describe("ocr pr prior-feedback", () => {
  it("maps threads, reviews (skipping empty bodies) and comments, detecting bots", async () => {
    const runGh = scriptedGh({
      reviewThreads: [
        page("reviewThreads", [
          thread(),
          thread({
            line: null,
            isResolved: true,
            isOutdated: true,
            comments: {
              nodes: [
                { url: "u2", body: "b", author: { login: "copilot", __typename: "Bot" } },
                { url: "u2a", body: "Fixed in f57d4f1", author: { login: "ana", __typename: "User" } },
                { url: "u2b", body: "x".repeat(2100), author: { login: "ci[bot]", __typename: "User" } },
              ],
            },
          }),
        ]),
      ],
      reviews: [
        page("reviews", [
          { url: "r1", state: "CHANGES_REQUESTED", body: "overall", author: { login: "ana", __typename: "User" } },
          { url: "r2", state: "APPROVED", body: "  ", author: { login: "bo", __typename: "User" } },
        ]),
      ],
      comments: [page("comments", [{ url: "c1", body: "ping", author: { login: "ci[bot]", __typename: "User" } }])],
    });

    const { path, file } = await runPriorFeedback(root, { pr: PR_URL, sessionId: "s1" }, { runGh, now });

    expect(path).toBe(join(sessionDir, "rounds", "round-2", "prior-feedback.json"));
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual(file);
    expect(file).toMatchObject({ schema_version: 1, pr: { number: 7, url: PR_URL }, fetched_at: "2026-03-01T00:00:00.000Z" });
    expect(file.github).toEqual({
      available: true,
      error: null,
      threads: [
        { url: "https://github.com/acme/app/pull/7#discussion_r1", path: "src/a.ts", line: 10, author: "ana", author_kind: "human", body: "fix this", is_resolved: false, is_outdated: false, replies: [] },
        {
          url: "u2", path: "src/a.ts", line: 8, author: "copilot", author_kind: "bot", body: "b", is_resolved: true, is_outdated: true,
          replies: [
            { url: "u2a", author: "ana", author_kind: "human", body: "Fixed in f57d4f1" },
            { url: "u2b", author: "ci[bot]", author_kind: "bot", body: "x".repeat(2000) },
          ],
        },
      ],
      reviews: [{ url: "r1", author: "ana", author_kind: "human", state: "CHANGES_REQUESTED", body: "overall" }],
      comments: [{ url: "c1", author: "ci[bot]", author_kind: "bot", body: "ping" }],
      totals: { threads: 2, reviews: 1, comments: 1 },
      truncated_bodies: 1,
    });
  });

  it("paginates with the endCursor until hasNextPage is false", async () => {
    const runGh = scriptedGh({
      comments: [
        page("comments", [{ url: "c1", body: "one", author: { login: "a", __typename: "User" } }], "CUR1"),
        page("comments", [{ url: "c2", body: "two", author: { login: "a", __typename: "User" } }]),
      ],
    });

    const { file } = await runPriorFeedback(root, { pr: PR_URL, sessionId: "s1" }, { runGh, now });

    expect(file.github.comments.map((c) => c.url)).toEqual(["c1", "c2"]);
    const commentCalls = runGh.mock.calls.map((c) => c[0]).filter((a) => a.some((x) => x.includes("comments(first:100")));
    expect(commentCalls).toHaveLength(2);
    expect(commentCalls[0]).not.toContain("after=CUR1");
    expect(commentCalls[1]).toContain("after=CUR1");
  });

  it("caps bodies at 2000 chars and counts the truncated ones", async () => {
    const runGh = scriptedGh({
      comments: [page("comments", [
        { url: "c1", body: "x".repeat(2500), author: { login: "a", __typename: "User" } },
        { url: "c2", body: "x".repeat(2000), author: { login: "a", __typename: "User" } },
      ])],
    });

    const { file } = await runPriorFeedback(root, { pr: PR_URL, sessionId: "s1" }, { runGh, now });

    expect(file.github.comments.map((c) => c.body.length)).toEqual([2000, 2000]);
    expect(file.github.truncated_bodies).toBe(1);
  });

  it("records a gh failure as github.available=false, still writes the file with OCR history", async () => {
    const db = await ensureDatabase(join(root, ".ocr"));
    insertSession(db, { id: "s0", branch: "b", workflow_type: "review", session_dir: join(root, ".ocr", "sessions", "s0"), pr_number: 7 });
    db.run("INSERT INTO review_rounds (session_id, round_number, posted_at) VALUES ('s0', 1, '2026-01-01 00:00:00')");
    db.run("INSERT INTO synthesis_findings (round_id, key, title, severity, category) VALUES (1, 'S1', 'an earlier finding', 'high', 'blocker')");
    const runGh = vi.fn().mockRejectedValue(Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }));

    const { path, file } = await runPriorFeedback(root, { pr: PR_URL, sessionId: "s1" }, { runGh, now });

    expect(file.github).toMatchObject({ available: false, threads: [], reviews: [], comments: [], totals: { threads: 0, reviews: 0, comments: 0 }, truncated_bodies: 0 });
    expect(file.github.error).toContain("`gh`");
    expect(file.ocr_history).toEqual([
      expect.objectContaining({ session_id: "s0", round: 1, key: "S1", title: "an earlier finding", decision_status: null, posted: true }),
    ]);
    expect(JSON.parse(readFileSync(path, "utf-8")).ocr_history).toHaveLength(1);
  });

  it("surfaces GraphQL errors and a missing PR as unavailable", async () => {
    const gql = vi.fn().mockResolvedValue(JSON.stringify({ errors: [{ message: "Bad credentials" }] }));
    const a = await runPriorFeedback(root, { pr: PR_URL, sessionId: "s1" }, { runGh: gql, now });
    expect(a.file.github).toMatchObject({ available: false, error: "Bad credentials" });

    const missing = vi.fn().mockResolvedValue(JSON.stringify({ data: { repository: { pullRequest: null } } }));
    const b = await runPriorFeedback(root, { pr: PR_URL, sessionId: "s1" }, { runGh: missing, now });
    expect(b.file.github.error).toContain("not found");
  });

  it("resolves a bare number from the session pr_url without calling gh repo view", async () => {
    const runGh = scriptedGh({});
    const { file } = await runPriorFeedback(root, { pr: "7", sessionId: "s1" }, { runGh, now });
    expect(file.pr).toEqual({ number: 7, url: PR_URL });
    expect(runGh.mock.calls.some((c) => c[0][0] === "repo")).toBe(false);
  });

  it("resolves a bare number via gh repo view when the session has no matching pr_url", async () => {
    const runGh = vi.fn(async (args: string[]) =>
      args[0] === "repo" ? JSON.stringify({ nameWithOwner: "other/repo" }) : page("comments", []),
    );
    const { file } = await runPriorFeedback(root, { pr: "9", sessionId: "s1" }, { runGh, now });
    expect(file.pr).toEqual({ number: 9, url: "https://github.com/other/repo/pull/9" });
    expect(file.github.available).toBe(true);
  });

  it("rejects an unknown session with NOT_FOUND and a malformed PR argument with USAGE", async () => {
    await expect(runPriorFeedback(root, { pr: PR_URL, sessionId: "nope" }, { runGh: scriptedGh({}), now })).rejects.toMatchObject({ code: 4 });
    await expect(runPriorFeedback(root, { pr: "abc", sessionId: "s1" }, { runGh: scriptedGh({}), now })).rejects.toMatchObject({ code: 2 });
  });
});
