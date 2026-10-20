import { project as projectWith } from "./jmespath.mjs";
import { loadCredentials } from "./credentials.mjs";

const cloudId = "5cc02313-0a4c-4986-8d69-e5ff03892bba";
const productBases = {
  jira: `https://api.atlassian.com/ex/jira/${cloudId}`,
  confluence: `https://api.atlassian.com/ex/confluence/${cloudId}`,
};
const maxResponseBytes = 1_000_000;

function redact(value) {
  return String(value)
    .replace(
      /\b(?:password|passwd|pwd|token|secret|api[_ -]?key)\s*[:=]\s*\S+/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|-----BEGIN [A-Z ]+PRIVATE KEY-----/g,
      "[REDACTED]",
    );
}

function clean(value) {
  if (Array.isArray(value)) {
    return value.map(clean);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, clean(entry)]),
    );
  }
  return typeof value === "string" ? redact(value) : value;
}

function project(value, expression) {
  if (!expression) {
    return value;
  }
  try {
    return projectWith(value, expression);
  } catch (error) {
    throw new Error(`Invalid projection: ${error.message}`);
  }
}

// Read-only allowlist for --path. Kept in step with scripts/check-tokens.sh so a
// hand-written path cannot reach a write endpoint.
const allowedPathPrefixes = ["/rest/api/3/", "/wiki/"];

async function get(product, path, query = {}, projection) {
  if (
    !path.startsWith("/") ||
    path.includes("//") ||
    !allowedPathPrefixes.some((prefix) => path.startsWith(prefix))
  ) {
    throw new Error(
      `Endpoint is not on the read-only allowlist (expected one of: ${allowedPathPrefixes.join(", ")})`,
    );
  }

  const url = new URL(`${productBases[product]}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const creds = await loadCredentials(product);
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(
          `${creds.email}:${creds.token}`,
        ).toString("base64")}`,
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const cause = error.cause?.message ? `: ${error.cause.message}` : "";
    throw new Error(`Atlassian connection failed${cause}`);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Atlassian GET failed (${response.status}): ${redact(text)}`);
  }
  if (Buffer.byteLength(text) > maxResponseBytes) {
    throw new Error("Atlassian response exceeded the 1 MB safety limit");
  }

  return clean(project(JSON.parse(text), projection));
}

export async function getIssue({ issueKey, projection }) {
  const issue = await get(
    "jira",
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
    {
      fields:
        "summary,description,status,assignee,reporter,priority,issuetype,labels,components,fixVersions,created,updated,comment",
    },
    projection,
  );
  return issue;
}

export async function searchIssues({ jql, limit, projection }) {
  return get(
    "jira",
    "/rest/api/3/search/jql",
    {
      jql,
      maxResults: Math.min(limit, 50),
      fields:
        "summary,status,assignee,priority,issuetype,labels,components,created,updated",
    },
    projection,
  );
}

// HTML to Markdown is a nicety, not a requirement: turndown is an optional
// dependency, so the CLI works before `npm install`. Without it the raw storage
// HTML is returned untouched.
async function toMarkdown(html) {
  try {
    const { default: TurndownService } = await import("turndown");
    return new TurndownService().turndown(html);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") {
      throw error;
    }
    return html;
  }
}

export async function getConfluencePage({ pageId, projection }) {
  const page = await get(
    "confluence",
    `/wiki/api/v2/pages/${encodeURIComponent(pageId)}`,
    { "body-format": "storage" },
    projection,
  );
  if (page?.body?.storage?.value) {
    page.body.storage.value = await toMarkdown(page.body.storage.value);
  }
  return page;
}

export async function searchConfluence({ cql, limit, projection }) {
  const result = await get(
    "confluence",
    "/wiki/rest/api/search",
    {
      cql,
      limit: Math.min(limit, 50),
    },
    projection,
  );
  return result;
}

// Escape hatch for read endpoints the named commands do not cover, such as
// Jira's changelog or Confluence page versions. Still GET-only and still gated
// by the allowlist above; the product also fixes the gateway host.
export async function rawGet(product, { path, query, projection }) {
  const params = {};
  if (query) {
    // JSON is the natural form for a shell argument; a plain a=b&c=d also works.
    const text = String(query).trim();
    if (text.startsWith("{")) {
      Object.assign(params, JSON.parse(text));
    } else {
      for (const pair of text.split("&")) {
        if (!pair) {
          continue;
        }
        const [key, ...rest] = pair.split("=");
        params[decodeURIComponent(key)] = decodeURIComponent(rest.join("="));
      }
    }
  }
  const endpoint = decodeURIComponent(String(path));
  const expected = product === "confluence" ? "/wiki/" : "/rest/api/3/";
  const normalized = normalizeApiPath(endpoint);
  if (!normalized.startsWith(expected)) {
    throw new Error(
      `Path for ${product} must start with ${expected} (got ${endpoint})`,
    );
  }
  return get(product, normalized, params, projection);
}

// Git Bash rewrites an argument that looks like a POSIX absolute path, so
// `--path /rest/api/3/...` arrives as `C:/Program Files/Git/rest/api/3/...`.
// Undo that when the tail matches the allowlist, and accept a full URL too.
function normalizeApiPath(path) {
  if (/^https?:\/\//i.test(path)) {
    const url = new URL(path);
    const gateway = url.pathname.indexOf("/rest/api/");
    const wiki = url.pathname.indexOf("/wiki/");
    const at = gateway !== -1 ? gateway : wiki;
    if (at === -1) {
      throw new Error("URL does not contain a /rest/api/ or /wiki/ endpoint");
    }
    return url.pathname.slice(at);
  }
  const marker = path.match(/\/?(?:rest\/api\/|wiki\/).*$/s);
  return marker ? `/${marker[0].replace(/^\//, "")}` : path;
}

// Test credential validity — minimal API call for quick validation.
// NOTE: /rest/api/3/myself is not usable for scope validation. This tenant's
// OAuth-less API allowlist rejects it with 401 "scope does not match" even for a
// correctly scoped token, which produces a false negative. Probe a real read
// endpoint and validate the response shape instead.
const testProbes = {
  jira: {
    url: "/rest/api/3/search/jql",
    query: { jql: "issuetype = Bug", maxResults: 1 },
    ok: (data) => Array.isArray(data?.issues),
  },
  confluence: {
    url: "/wiki/rest/api/search",
    query: { cql: "type = page", limit: 1 },
    ok: (data) => Array.isArray(data?.results),
  },
};

async function testCreds(product) {
  const probe = testProbes[product];
  if (!probe) {
    return { valid: false, product, error: `Unknown product '${product}'` };
  }
  const creds = await loadCredentials(product);
  const url = new URL(`${productBases[product]}${probe.url}`);
  for (const [key, value] of Object.entries(probe.query)) {
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(
        `${creds.email}:${creds.token}`,
      ).toString("base64")}`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.text();
  if (!response.ok) {
    return { valid: false, product, error: body };
  }
  try {
    if (!probe.ok(JSON.parse(body))) {
      return { valid: false, product, error: "unexpected response shape" };
    }
  } catch (error) {
    return { valid: false, product, error: error.message };
  }
  return { valid: true, account: creds.email, product };
}

// CLI entry point (when run directly)
const product = process.argv[2];
const command = process.argv[3];
if (product && command) {
  // Standalone test mode: `node atlassian.mjs test [jira|confluence]`
  if (product === "test" || product === "--test") {
    const target = command || "jira";
    const result = await testCreds(target);
    if (!result.valid) {
      console.error(`Token invalid for ${result.product}: ${result.error}`);
      process.exit(1);
    }
    console.log(`Token valid for ${result.product} (${result.account})`);
    process.exit(0);
  }
  const commands = {
    jira: {
      get_issue: async (args) => getIssue(args),
      search_issues: async (args) => searchIssues(args),
      get: async (args) => rawGet("jira", args),
    },
    confluence: {
      get_page: async (args) => getConfluencePage(args),
      search: async (args) => searchConfluence(args),
      get: async (args) => rawGet("confluence", args),
    },
  };

  const commandKey = command.replace(/-/g, "_");
  if (!commands[product]?.[commandKey]) {
    if (product === "test") {
      console.error(
        `Usage: ${process.argv[1]} test [jira|confluence]`,
      );
    } else {
      console.error(
        `Usage: ${process.argv[1]} <jira|confluence> <command> [options]`,
      );
    }
    console.error("Commands:");
    console.error("  jira get-issue --issue-key KEY [--projection JMESPATH]");
    console.error("  jira search-issues --jql 'QUERY' [--limit N] [--projection JMESPATH]");
    console.error("  confluence get-page --page-id ID [--projection JMESPATH]");
    console.error("  confluence search --cql 'QUERY' [--limit N] [--projection JMESPATH]");
    console.error("  <product> get --path /rest/api/3/... [--query 'a=b&c=d'] [--projection EXPR]");
    process.exit(1);
  }

  const parsed = {};
  const flags = {
    get_issue: ["issue-key"],
    search_issues: ["jql", "limit", "projection"],
    get_page: ["page-id", "projection"],
    search: ["cql", "limit", "projection"],
    get: ["path", "query", "projection"],
  };
  for (const flag of flags[commandKey] || []) {
    const dashFlag = `--${flag}`;
    const idx = process.argv.indexOf(dashFlag);
    if (idx !== -1 && idx + 1 < process.argv.length) {
      parsed[flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] =
        process.argv[idx + 1];
    }
  }

  try {
    const result = await commands[product][commandKey](parsed);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exit(1);
  }
  process.exit(0);
}
