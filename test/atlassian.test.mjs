import assert from "node:assert/strict";
import test from "node:test";

process.env.ATLASSIAN_USER_EMAIL = "user@example.com";
process.env.ATLASSIAN_JIRA_API_TOKEN = "test-token";

const { getIssue, searchIssues } = await import("../skills/atlassian.mjs");

test("Jira requests retain the scoped-token gateway path", async (context) => {
  const originalFetch = globalThis.fetch;
  const urls = [];

  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ fields: {} }), {
      headers: { "content-type": "application/json" },
    });
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  await getIssue({ issueKey: "HEC-5153" });
  await searchIssues({ jql: "key = HEC-5153", limit: 1 });

  assert.equal(
    new URL(urls[0]).pathname,
    "/ex/jira/5cc02313-0a4c-4986-8d69-e5ff03892bba/rest/api/3/issue/HEC-5153",
  );
  assert.equal(
    new URL(urls[1]).pathname,
    "/ex/jira/5cc02313-0a4c-4986-8d69-e5ff03892bba/rest/api/3/search/jql",
  );
});
