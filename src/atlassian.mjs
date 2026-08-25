import jmespath from "jmespath";
import TurndownService from "turndown";
import { loadCredentials } from "./credentials.mjs";

const cloudId = "5cc02313-0a4c-4986-8d69-e5ff03892bba";
const productBases = {
  jira: `https://api.atlassian.com/ex/jira/${cloudId}`,
  confluence: `https://api.atlassian.com/ex/confluence/${cloudId}`,
};
const turndown = new TurndownService();
const maxResponseBytes = 1_000_000;

async function credentials(product) {
  const { email, token } = await loadCredentials(product);
  return Buffer.from(`${email}:${token}`).toString("base64");
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

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${await credentials(product)}`,
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
