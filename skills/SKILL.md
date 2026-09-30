---
name: atlassian-readonly
description: Read Jira issues and Confluence pages via direct scripts or MCP server. Supports JQL search, CQL search, issue retrieval, and page viewing with JMESPath projections.
---

# Atlassian Read-only

Read Jira and Confluence Cloud data using the Atlassian Read-only runtime. No write operations are available. This skill is instructions only; install the runtime separately and set `ATLASSIAN_READONLY_HOME` to its checkout path.

## Prerequisites

Clone and install the runtime once:

```powershell
git clone https://github.com/AlexSchaap-TMMC/atlassian-readonly.git C:\Tools\atlassian-readonly
Set-Location C:\Tools\atlassian-readonly
npm ci
$env:ATLASSIAN_READONLY_HOME = "C:\Tools\atlassian-readonly"
npm run configure -- jira
npm run configure -- confluence
```

On macOS/Linux, use a shell variable and the same runtime commands:

```bash
git clone https://github.com/AlexSchaap-TMMC/atlassian-readonly.git ~/Tools/atlassian-readonly
cd ~/Tools/atlassian-readonly
npm ci
export ATLASSIAN_READONLY_HOME="$HOME/Tools/atlassian-readonly"
npm run configure -- jira
npm run configure -- confluence
```

Set the account email in the environment used to run the commands:

```powershell
$env:ATLASSIAN_USER_EMAIL = "your.email@example.com"
```

For macOS/Linux:

```bash
export ATLASSIAN_USER_EMAIL="your.email@example.com"
```

For headless/WSL systems, use token files and set the variables in the agent
environment instead:

```bash
export ATLASSIAN_JIRA_TOKEN_FILE=~/.config/atlassian-jira-token
export ATLASSIAN_CONFLUENCE_TOKEN_FILE=~/.config/atlassian-confluence-token
```

## Direct Script Execution

Run the bundled script directly for fast, token-efficient access:

```powershell
# Read a Jira issue
node "$env:ATLASSIAN_READONLY_HOME\scripts\atlassian.mjs" jira get-issue --issue-key HEC-123

# Search Jira with JQL
node "$env:ATLASSIAN_READONLY_HOME\scripts\atlassian.mjs" jira search-issues --jql 'project=HEC AND status=Open' --limit 10

# Read a Confluence page
node "$env:ATLASSIAN_READONLY_HOME\scripts\atlassian.mjs" confluence get-page --page-id 123456789

# Search Confluence with CQL
node "$env:ATLASSIAN_READONLY_HOME\scripts\atlassian.mjs" confluence search --cql 'title ~ "Kafka"' --limit 10
```

On macOS/Linux, use `$ATLASSIAN_READONLY_HOME/scripts/atlassian.mjs` as the
script path.

## MCP Server (Legacy)

For persistent tool integration in MCP-compatible hosts, configure the bundled
server as a stdio MCP server. This is legacy; prefer direct script execution
for most use cases.

```powershell
node "$env:ATLASSIAN_READONLY_HOME\src\server.mjs"
```

On macOS/Linux:

```bash
node "$ATLASSIAN_READONLY_HOME/src/server.mjs"
```

Configure as stdio MCP server. Exposes tools: `jira_get_issue`, `jira_search_issues`, `confluence_get_page`, `confluence_search`.

## Workflow

1. **Find a Jira issue** — Use `node "$ATLASSIAN_READONLY_HOME/scripts/atlassian.mjs" jira get-issue --issue-key HEC-123`
2. **Search Jira** — Use `node "$ATLASSIAN_READONLY_HOME/scripts/atlassian.mjs" jira search-issues --jql 'project=HEC' --limit 10`. Use `--projection` to control output.
3. **Read a Confluence page** — Use `node "$ATLASSIAN_READONLY_HOME/scripts/atlassian.mjs" confluence get-page --page-id 123`. HTML is auto-converted to Markdown.
4. **Search Confluence** — Use `node "$ATLASSIAN_READONLY_HOME/scripts/atlassian.mjs" confluence search --cql 'title ~ "Kafka"' --limit 10`. Use `--projection` to control output.

Or when using the MCP server, invoke tools: `jira_get_issue`, `jira_search_issues`, `confluence_get_page`, `confluence_search`.

## JMESPath Projections

Reduce returned data by adding the `projection` parameter to any command:

```bash
node "$ATLASSIAN_READONLY_HOME/scripts/atlassian.mjs" jira search-issues --jql 'project=HEC' --projection 'issues[*].{key,summary,status.name}'
node "$ATLASSIAN_READONLY_HOME/scripts/atlassian.mjs" confluence get-page --page-id 123 --projection 'title,body[storage].value'
```

## Default Parameter Values

| Tool | Parameter | Default |
|------|-----------|---------|
| `jira_search_issues` | `limit` | 20 |
| `confluence_search` | `limit` | 20 |
| All tools | `projection` | None (full response) |

## Security Notes

- This integration is **read-only only**. No write operations are implemented.
- Responses are size-limited to 1 MB.
- Secrets in responses are redacted (passwords, API keys, tokens).
- Tokens should have read-only scopes only.
