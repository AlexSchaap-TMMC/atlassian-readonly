---
name: atlassian-readonly
description: Read Jira issues and Confluence pages via direct scripts or MCP server. Supports JQL search, CQL search, issue retrieval, and page viewing with JMESPath projections.
---

# Atlassian Read-only

Read Jira and Confluence Cloud data. No write operations are available.

## Setup

Install the skill and its dependencies, then configure credentials:

```bash
npx skills add AlexSchaap-TMMC/atlassian-readonly --skill atlassian-readonly
cd "$HOME/.agents/skills/atlassian-readonly"
npm install
npm run configure -- jira
npm run configure -- confluence
export ATLASSIAN_USER_EMAIL="your.email@example.com"
```

**Token configuration** — The `configure` script automatically opens your browser to the [Atlassian API tokens page](https://id.atlassian.com/manage-profile/security/api-tokens) with instructions for the correct scopes. See [references/setup.md](references/setup.md) for full details on token creation, credential storage, headless/WSL setups, and troubleshooting.

## Token Validation & Auto-refresh

Check tokens before API calls to avoid wasted requests:

```bash
bash "$ATLAS_SKILL_DIR/scripts/check-tokens.sh" jira
```

Or using the bundled script:

```bash
node "$ATLAS_SKILL_DIR/atlassian.mjs" test jira
```

Exit 0 = valid, exit 1 = invalid. When a check fails or API returns 401:

1. Update the token file: `printf '%s' "new-token" > ~/.config/atlassian-jira-token`
2. Re-run the check to confirm.

## Direct Script Execution

Run bundled tools directly for fast, token-efficient access:

```bash
# Read a Jira issue
node "$ATLAS_SKILL_DIR/atlassian.mjs" jira get-issue --issue-key HEC-123

# Search Jira with JQL
node "$ATLAS_SKILL_DIR/atlassian.mjs" jira search-issues --jql 'project=HEC AND status=Open' --limit 10

# Read a Confluence page
node "$ATLAS_SKILL_DIR/atlassian.mjs" confluence get-page --page-id 123456789

# Search Confluence with CQL
node "$ATLAS_SKILL_DIR/atlassian.mjs" confluence search --cql 'title ~ "Kafka"' --limit 10
```

## MCP Server

The bundled server exposes four tools via stdio: `jira_get_issue`, `jira_search_issues`, `confluence_get_page`, `confluence_search`.

## JMESPath Projections

Reduce response size with JMESPath expressions:

```bash
node "$ATLAS_SKILL_DIR/atlassian.mjs" jira search-issues --jql 'project=HEC' --projection 'issues[*].{key,summary,status.name}'
node "$ATLAS_SKILL_DIR/atlassian.mjs" confluence get-page --page-id 123 --projection 'title,body[storage].value'
```

## Default Parameter Values

| Tool | Parameter | Default |
|------|-----------|---------|
| `jira_search_issues` | `limit` | 20 |
| `confluence_search` | `limit` | 20 |
| All tools | `projection` | None (full response) |
