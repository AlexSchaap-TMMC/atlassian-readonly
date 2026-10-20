---
name: atlassian-readonly
description: Read Jira issues and Confluence pages via direct scripts or MCP server. Supports JQL search, CQL search, issue retrieval, page viewing, and arbitrary read endpoints, with projections.
---

# Atlassian Read-only

Read Jira and Confluence Cloud data. No write operations are available.

## Setup

One command stores credentials, configures corporate TLS, and verifies both tokens:

```bash
cd "$ATLAS_SKILL_DIR" && npm run setup
```

Non-interactive (for agents and CI):

```bash
npm run setup -- "<email>" "<jira-token>" "<confluence-token>"
```

Verify an existing setup without changing anything:

```bash
npm run setup -- --check
```

No install step is needed: the scripts use Node built-ins only. `npm install` is
required only for the MCP server and for Markdown conversion of page bodies
([DEPENDENCIES.md](../DEPENDENCIES.md)). Setup writes to the OS credential store,
or to `~/.config/atlassian-*-token` where none exists. It never writes tokens into
the skill directory.

Token creation, scopes, rotation, headless/WSL setups, and troubleshooting:
[references/setup.md](references/setup.md).

## Token Validation

Check tokens before API calls to avoid wasted requests:

```bash
bash "$ATLAS_SKILL_DIR/scripts/check-tokens.sh" jira
node "$ATLAS_SKILL_DIR/atlassian.mjs" test confluence
```

Exit 0 = valid, exit 1 = invalid. Both probe a real read endpoint, so a `scope does not
match` 401 from a validator means the probe assumption is wrong, not necessarily the
token — see [references/setup.md](references/setup.md#troubleshooting).

## ⚠️ Critical Debug Checklist (Read First)

Before making any API calls, verify:

- **Don't skip the email check** — Set `ATLASSIAN_USER_EMAIL` env var, `userEmail` in
  `config.json`, **or** the file `~/.config/atlassian-user-email`
- **Don't assume the credential store is empty** — the store is tried before token files,
  unless a token file is pinned
- **Don't use display names as space keys** — Confluence space key may differ from page
  title (e.g., "HECTOR" space → key is `HEC`)
- **Don't forget corporate TLS** — handled by `npm run setup`; see
  [references/setup.md](references/setup.md#corporate-certificates)

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

## Any Other Read Endpoint

When a named command does not cover what you need, `get` calls any allowlisted GET path.
Use it for change history, page versions, spaces, and users:

```bash
node "$ATLAS_SKILL_DIR/atlassian.mjs" jira get \
  --path '/rest/api/3/issue/HEC-123/changelog' --projection 'values[*].id'

node "$ATLAS_SKILL_DIR/atlassian.mjs" confluence get \
  --path '/wiki/api/v2/pages' --query 'limit=5&sort=-created-date' --projection 'results[*].{t: title}'
```

Allowlist: Jira `/rest/api/3/...`, Confluence `/wiki/...`. GET only. A full URL is also
accepted and reduced to its endpoint path. This tenant allowlists endpoints per token, so
a `scope does not match` 401 on an unfamiliar path is an Atlassian permission result, not
a bug in this skill.

## MCP Server

The bundled server exposes four tools via stdio: `jira_get_issue`, `jira_search_issues`,
`confluence_get_page`, `confluence_search`. Requires `npm install`.

## Projections

Reduce response size with a projection expression (a JMESPath subset):

```bash
node "$ATLAS_SKILL_DIR/atlassian.mjs" jira search-issues --jql 'project=HEC' --projection 'issues[*].{key: key, summary: fields.summary, status: fields.status.name}'
node "$ATLAS_SKILL_DIR/atlassian.mjs" confluence get-page --page-id 123 --projection 'title'
```

Supported: `a.b.c`, `[0]`, `[-1]`, `["key"]`, `[*]`, `{k: expr, k2: expr}`, `|`, `@`,
`length()`. Not supported: filters (`[?a=='b']`), slices (`[0:5]`), and functions other
than `length()`. Unsupported syntax fails with an explicit error rather than returning
wrong data. `{key, summary}` shorthand is invalid — entries need `name: expression`.

## Default Parameter Values

| Tool | Parameter | Default |
|------|-----------|---------|
| `jira_search_issues` | `limit` | 20 |
| `confluence_search` | `limit` | 20 |
| All tools | `projection` | None (full response) |
