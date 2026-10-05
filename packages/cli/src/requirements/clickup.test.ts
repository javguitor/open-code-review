import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fetchClickUp } from "./clickup.js";
import { renderSourceMarkdown } from "./render.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf-8"));

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const TOKEN = "pk_secret_token";

describe("fetchClickUp", () => {
  it("builds the request and prefers markdown_description", async () => {
    const f = vi.fn().mockResolvedValue(json(fixture("clickup-task.json")));
    const src = await fetchClickUp("https://app.clickup.com/t/abc123", {
      withComments: false,
      token: TOKEN,
      fetchImpl: f,
    });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.clickup.com/api/v2/task/abc123?include_markdown_description=true");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: TOKEN });
    expect(src).toMatchObject({
      type: "clickup",
      id: "abc123",
      title: "Add export to CSV",
      descriptionFormat: "markdown",
      author: "ana",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(src.body).toContain("**export**");
    expect(src.comments).toBeUndefined();
  });

  it("extracts checklists and custom fields, resolving dropdown/labels and skipping empties", async () => {
    const src = await fetchClickUp("https://app.clickup.com/t/abc123", {
      withComments: false,
      token: TOKEN,
      fetchImpl: vi.fn().mockResolvedValue(json(fixture("clickup-task.json"))),
    });
    expect(src.checklists).toEqual([
      {
        name: "Acceptance",
        items: [
          { text: "Button visible", resolved: true },
          { text: "File downloads", resolved: false },
        ],
      },
    ]);
    expect(src.customFields).toEqual([
      { name: "Priority", value: "High" },
      { name: "Estimate", value: "5" },
      { name: "Areas", value: "Frontend" },
    ]);
    const md = renderSourceMarkdown(src);
    expect(md).toContain("- [x] Button visible");
    expect(md).toContain("- [ ] File downloads");
    expect(md).toContain("- Priority: High");
    expect(md).not.toContain("## Comments");
  });

  it("falls back to the plain description", async () => {
    const src = await fetchClickUp("https://app.clickup.com/t/def456", {
      withComments: false,
      token: TOKEN,
      fetchImpl: vi.fn().mockResolvedValue(json(fixture("clickup-task-plain.json"))),
    });
    expect(src.descriptionFormat).toBe("plain");
    expect(src.body).toBe("Only plain text here");
  });

  it("flags custom ids with team_id", async () => {
    const f = vi.fn().mockResolvedValue(json(fixture("clickup-task.json")));
    await fetchClickUp("https://app.clickup.com/t/9012/PROJ-42", { withComments: false, token: TOKEN, fetchImpl: f });
    expect(f.mock.calls[0]![0]).toBe(
      "https://api.clickup.com/api/v2/task/PROJ-42?include_markdown_description=true&custom_task_ids=true&team_id=9012",
    );
  });

  it("fetches comments oldest-first when requested", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json(fixture("clickup-task.json")))
      .mockResolvedValueOnce(json(fixture("clickup-comments.json")));
    const src = await fetchClickUp("https://app.clickup.com/t/abc123", { withComments: true, token: TOKEN, fetchImpl: f });
    expect(f.mock.calls[1]![0]).toBe("https://api.clickup.com/api/v2/task/abc123/comment");
    expect(src.comments).toEqual([
      { author: "ana", date: "2026-01-01T00:00:00.000Z", text: "First" },
      { author: "bob", date: "2026-01-02T00:00:00.000Z", text: "Second" },
    ]);
  });

  it("caps comments to the last 50 across pages", async () => {
    const page = (from: number, n: number) => ({
      comments: Array.from({ length: n }, (_, i) => ({
        id: `c${from - i}`,
        comment_text: `t${from - i}`,
        user: { username: "u" },
        date: String(1767225600000 + (from - i) * 1000),
      })),
    });
    const f = vi
      .fn()
      .mockResolvedValueOnce(json(fixture("clickup-task.json")))
      .mockResolvedValueOnce(json(page(60, 25)))
      .mockResolvedValueOnce(json(page(35, 25)))
      .mockResolvedValueOnce(json(page(10, 10)));
    const src = await fetchClickUp("https://app.clickup.com/t/abc123", { withComments: true, token: TOKEN, fetchImpl: f });
    expect(src.comments).toHaveLength(50);
    expect(src.comments![49]!.text).toBe("t60");
    expect(src.comments![0]!.text).toBe("t11");
  });

  it("fails with missing-token naming the variable, without fetching", async () => {
    const f = vi.fn();
    await expect(
      fetchClickUp("https://app.clickup.com/t/abc123", { withComments: false, token: undefined, fetchImpl: f }),
    ).rejects.toMatchObject({ code: "missing-token", message: expect.stringContaining("CLICKUP_API_KEY") });
    expect(f).not.toHaveBeenCalled();
  });

  it("maps 404 to not-found", async () => {
    await expect(
      fetchClickUp("https://app.clickup.com/t/zzz", {
        withComments: false,
        token: TOKEN,
        fetchImpl: vi.fn().mockResolvedValue(json({ err: "Task not found" }, 404)),
      }),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("maps 401 to fetch-failed without leaking the token", async () => {
    const err = await fetchClickUp("https://app.clickup.com/t/abc123", {
      withComments: false,
      token: TOKEN,
      fetchImpl: vi.fn().mockResolvedValue(json({ err: "Token invalid" }, 401)),
    }).catch((e: Error) => e);
    expect(err).toMatchObject({ code: "fetch-failed" });
    expect((err as Error).message).not.toContain(TOKEN);
  });

  it("maps a network error to fetch-failed", async () => {
    await expect(
      fetchClickUp("https://app.clickup.com/t/abc123", {
        withComments: false,
        token: TOKEN,
        fetchImpl: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
      }),
    ).rejects.toMatchObject({ code: "fetch-failed" });
  });

  it("a request that never resolves aborts via the signal → fetch-failed (timeout)", async () => {
    const f = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    await expect(
      fetchClickUp("https://app.clickup.com/t/abc123", { withComments: false, token: TOKEN, fetchImpl: f, timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: "fetch-failed", message: expect.stringContaining("did not respond") });
    expect(f.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
