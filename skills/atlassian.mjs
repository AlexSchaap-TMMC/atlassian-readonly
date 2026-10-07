import jmespath from "jmespath";
import TurndownService from "turndown";
import { readFile } from "node:fs/promises";
import { Entry } from "@napi-rs/keyring";

const cloudId = "5cc02313-0a4c-4986-8d69-e5ff03892bba";
const productBases = {
  jira: `https://api.atlassian.com/ex/jira/${cloudId}`,
  confluence: `https://api.atlassian.com/ex/confluence/${cloudId}`,
};
const turndown = new TurndownService();
const maxResponseBytes = 1_000_000;

async function credentials(product) {
  const email = process.env.ATLASSIAN_USER_EMAIL;
  let token = new Entry(
    "atlassian-readonly-mcp",
    `toyota.atlassian.net:${product}`,
  ).getPassword();

  const file = process.env[`ATLASSIAN_${product.toUpperCase()}_TOKEN_FILE`];
  if (!token && file) {
    token = (await readFile(file, "utf8")).trim();
  }
  token ||= process.env[`ATLASSIAN_${product.toUpperCase()}_API_TOKEN`];

  if (!email || !token) {
    throw new Error(
      `Run 'npm run configure -- ${product}' or configure the ${product} token file`,
    );
  }

  return { email, token };
}

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
    return jmespath.search(value, expression);
  } catch (error) {
    throw new Error(`Invalid JMESPath projection: ${error.message}`);
  }
}

async function get(product, path, query = {}, projection) {
  if (!path.startsWith("/rest/api/3/") && !path.startsWith("/wiki/")) {
    throw new Error("Endpoint is not on the read-only allowlist");
  }

  const url = new URL(`${productBases[product]}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const creds = await credentials(product);
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

export async function getConfluencePage({ pageId, projection }) {
  const page = await get(
    "confluence",
    `/wiki/api/v2/pages/${encodeURIComponent(pageId)}`,
    { "body-format": "storage" },
    projection,
  );
  if (page?.body?.storage?.value) {
    page.body.storage.value = turndown.turndown(page.body.storage.value);
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

// Test credential validity — minimal API call for quick validation
async function testCreds(product) {
  const creds = await credentials(product);
  const url = new URL(
    `${productBases[product]}/rest/api/3/myself`,
  );
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
    return { valid: false, error: body };
  }
  const data = JSON.parse(body);
  return { valid: true, account: data.emailAddress, product };
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
    },
    confluence: {
      get_page: async (args) => getConfluencePage(args),
      search: async (args) => searchConfluence(args),
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
    process.exit(1);
  }

  const parsed = {};
  const flags = {
    get_issue: ["issue-key"],
    search_issues: ["jql", "limit", "projection"],
    get_page: ["page-id", "projection"],
    search: ["cql", "limit", "projection"],
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
