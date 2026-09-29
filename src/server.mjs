#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

import {
  getConfluencePage,
  getIssue,
  searchConfluence,
  searchIssues,
} from "../scripts/atlassian.mjs";

function textResult(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

const projection = z
  .string()
  .optional()
  .describe("Optional JMESPath projection to reduce returned fields.");

const server = new McpServer({
  name: "atlassian-readonly",
  version: "0.1.0",
});

server.registerTool(
  "jira_get_issue",
  {
    description: "Read one Jira issue. This server has no write operations.",
    inputSchema: z.object({
      issue_key: z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/),
      projection,
    }),
  },
  async ({ issue_key: issueKey, projection: select }) =>
    textResult(await getIssue({ issueKey: issueKey, projection: select })),
);

server.registerTool(
  "jira_search_issues",
  {
    description:
      "Search Jira with JQL. Results and fields are bounded; this server has no write operations.",
    inputSchema: z.object({
      jql: z.string().min(1).max(2000),
      limit: z.number().int().min(1).max(50).default(20),
      projection,
    }),
  },
  async ({ jql, limit, projection: select }) =>
    textResult(
      await searchIssues({ jql: jql, limit: limit, projection: select }),
    ),
);

server.registerTool(
  "confluence_get_page",
  {
    description:
      "Read a Confluence page by ID and convert storage HTML to Markdown. This server has no write operations.",
    inputSchema: z.object({
      page_id: z.string().regex(/^\d+$/),
      projection,
    }),
  },
  async ({ page_id: pageId, projection: select }) =>
    textResult(
      await getConfluencePage({ pageId: pageId, projection: select }),
    ),
);

server.registerTool(
  "confluence_search",
  {
    description:
      "Search Confluence with CQL. Results are bounded; this server has no write operations.",
    inputSchema: z.object({
      cql: z.string().min(1).max(2000),
      limit: z.number().int().min(1).max(50).default(20),
      projection,
    }),
  },
  async ({ cql, limit, projection: select }) =>
    textResult(
      await searchConfluence({ cql: cql, limit: limit, projection: select }),
    ),
);

await server.connect(new StdioServerTransport());
