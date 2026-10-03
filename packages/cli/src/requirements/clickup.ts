import { parseClickUpUrl } from "./detect.js";
import {
  capComments,
  RequirementsError,
  type Checklist,
  type CustomField,
  type RequirementSource,
  type SourceComment,
} from "./types.js";

export const CLICKUP_TOKEN_ENV = "CLICKUP_API_TOKEN";
const API = "https://api.clickup.com/api/v2";
const COMMENT_PAGE_SIZE = 25;
const MAX_COMMENT_PAGES = 5;

type FetchFn = typeof fetch;

type ClickUpOption = { id?: string; name?: string; label?: string; orderindex?: number };
type ClickUpField = {
  name: string;
  type?: string;
  value?: unknown;
  type_config?: { options?: ClickUpOption[] };
};
type ClickUpTask = {
  id?: string;
  name?: string;
  url?: string;
  description?: string;
  markdown_description?: string;
  date_updated?: string | number;
  creator?: { username?: string };
  checklists?: Array<{ name?: string; items?: Array<{ name?: string; resolved?: boolean }> }>;
  custom_fields?: ClickUpField[];
};
type ClickUpComment = {
  id?: string;
  comment_text?: string;
  user?: { username?: string };
  date?: string | number;
};

const isoFromMs = (ms: string | number | undefined): string => {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : "";
};

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Turns a raw custom-field value into display text, resolving option ids/indexes to names. */
function formatFieldValue(field: ClickUpField): string {
  const options = field.type_config?.options ?? [];
  const optionName = (match: (o: ClickUpOption) => boolean): string | undefined => {
    const o = options.find(match);
    return o ? (o.name ?? o.label) : undefined;
  };
  const value = field.value;
  switch (field.type) {
    case "drop_down": {
      // ClickUp stores the selected option's orderindex (sometimes its id).
      const name = optionName((o) => o.orderindex === value || o.id === value);
      return name ?? String(value);
    }
    case "labels": {
      const ids = Array.isArray(value) ? value : [value];
      return ids.map((id) => optionName((o) => o.id === id) ?? String(id)).join(", ");
    }
    case "date":
      return isoFromMs(value as string | number) || String(value);
    case "users":
      return (Array.isArray(value) ? value : [value])
        .map((u) => (u as { username?: string })?.username ?? String(u))
        .join(", ");
    default:
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

function extractCustomFields(fields: ClickUpField[] | undefined): CustomField[] {
  return (fields ?? [])
    .filter((f) => !isEmpty(f.value))
    .map((f) => ({ name: f.name, value: formatFieldValue(f) }));
}

function extractChecklists(task: ClickUpTask): Checklist[] {
  return (task.checklists ?? []).map((c) => ({
    name: c.name ?? "Checklist",
    items: (c.items ?? []).map((i) => ({ text: i.name ?? "", resolved: i.resolved === true })),
  }));
}

export async function fetchClickUp(
  url: string,
  opts: { withComments: boolean; token: string | undefined; fetchImpl?: FetchFn },
): Promise<RequirementSource> {
  const ref = parseClickUpUrl(url);
  if (!ref) throw new RequirementsError("invalid-source", `Not a ClickUp task URL: ${url}`);
  const token = opts.token?.trim();
  if (!token) {
    throw new RequirementsError(
      "missing-token",
      `${CLICKUP_TOKEN_ENV} is not set. Export a ClickUp personal API token in the environment to fetch ClickUp tasks.`,
    );
  }
  const doFetch = opts.fetchImpl ?? fetch;
  // Custom ids (`/t/<team>/<custom-id>`) must be flagged on the API call.
  const custom = ref.teamId
    ? `&custom_task_ids=true&team_id=${encodeURIComponent(ref.teamId)}`
    : "";
  const taskPath = `/task/${encodeURIComponent(ref.id)}`;

  const getJson = async <T>(pathAndQuery: string): Promise<T> => {
    let res: Response;
    try {
      res = await doFetch(`${API}${pathAndQuery}`, {
        headers: { Authorization: token, Accept: "application/json" },
      });
    } catch (error) {
      throw new RequirementsError(
        "fetch-failed",
        `Could not reach ClickUp: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new RequirementsError(
        "fetch-failed",
        `ClickUp rejected the credentials (HTTP ${res.status}); check ${CLICKUP_TOKEN_ENV} and that the token can access this task.`,
      );
    }
    if (res.status === 404) {
      throw new RequirementsError("not-found", `ClickUp task not found: ${url}`);
    }
    if (!res.ok) {
      throw new RequirementsError("fetch-failed", `ClickUp returned HTTP ${res.status} for ${url}`);
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new RequirementsError("fetch-failed", `ClickUp returned invalid JSON for ${url}`);
    }
  };

  const task = await getJson<ClickUpTask>(`${taskPath}?include_markdown_description=true${custom}`);

  const markdown = task.markdown_description?.trim();
  const plain = task.description?.trim() ?? "";
  const source: RequirementSource = {
    type: "clickup",
    id: ref.id,
    url: task.url ?? url.trim(),
    title: task.name ?? ref.id,
    body: markdown ? task.markdown_description! : plain,
    descriptionFormat: markdown ? "markdown" : "plain",
    checklists: extractChecklists(task),
    customFields: extractCustomFields(task.custom_fields),
    updatedAt: isoFromMs(task.date_updated),
    author: task.creator?.username ?? null,
  };

  if (opts.withComments) {
    source.comments = capComments(await fetchComments(getJson, taskPath, custom));
  }
  return source;
}

/**
 * Pages through `/comment` (25 per page, paged back in time with
 * `start` + `start_id`) until the cap is covered. Deduplicates by id so an
 * unexpected paging behaviour can never loop.
 */
async function fetchComments(
  getJson: <T>(p: string) => Promise<T>,
  taskPath: string,
  custom: string,
): Promise<SourceComment[]> {
  const seen = new Map<string, ClickUpComment>();
  let query = custom ? `?${custom.slice(1)}` : "";
  for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
    const { comments = [] } = await getJson<{ comments?: ClickUpComment[] }>(
      `${taskPath}/comment${query}`,
    );
    const before = seen.size;
    for (const c of comments) seen.set(c.id ?? `${c.date}-${c.comment_text}`, c);
    if (comments.length < COMMENT_PAGE_SIZE || seen.size === before || seen.size >= 50) break;
    const oldest = comments.reduce((a, b) => (Number(a.date) <= Number(b.date) ? a : b));
    query = `?start=${oldest.date}&start_id=${oldest.id}${custom}`;
  }
  return [...seen.values()].map((c) => ({
    author: c.user?.username ?? "unknown",
    date: isoFromMs(c.date),
    text: c.comment_text ?? "",
  }));
}
