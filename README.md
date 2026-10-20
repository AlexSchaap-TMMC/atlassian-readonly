# Atlassian Read-only

> Read-only Jira and Confluence toolkit for AI agents — no write operations are possible.

[![License: Internal](https://img.shields.io/badge/License-Internal%20Only-red.svg)](#license)
[![Node ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org)

## 📋 Table of Contents

- [Features](#features)
- [Three Ways to Use](#three-ways-to-use)
- [Quick Start](#quick-start)
- [Direct Script Execution](#direct-script-execution)
- [MCP Server](#mcp-server)
- [Create API Tokens](#create-api-tokens)
- [Store & Rotate Credentials](#store--rotate-credentials)
- [Troubleshooting](#troubleshooting)
- [WSL & Headless Systems](#wsl--headless-systems)
- [Repository Layout](#repository-layout)
- [Security](#security)
- [License](#license)

---

## Features

| Capability | Jira | Confluence |
|------------|------|------------|
| Read a single issue/page | ✅ `get-issue` | ✅ `get-page` |
| Search with query language | ✅ JQL | ✅ CQL |
| Projections (JMESPath subset) | ✅ | ✅ |
| Any allowlisted read endpoint | ✅ `get` | ✅ `get` |
| Response size limits | ✅ | ✅ |
| Secret redaction | ✅ | ✅ |
| HTML→Markdown conversion | — | ✅ optional dependency |

**Read-only by construction** — only GET, allowlisted paths, no POST/PUT/PATCH/DELETE.

---

## Three Ways to Use

| Method | Best for | Setup |
|--------|----------|-------|
| **Agent Skill** | Casual queries via Claude/Copilot | `npx skills add ...` then `npm run setup` |
| **MCP Server** | Persistent tool integration in VS Code, CLI, Claude Code | Config file |
| **Direct Script** | Scripts, CI, token-efficient calls | `node atlassian.mjs ...` |

---

## Quick Start

### 1. Install the skill

```bash
npx skills add AlexSchaap-TMMC/atlassian-readonly --skill atlassian-readonly
```

The `--skill` argument is required because the GitHub repository may contain multiple skills (multiple directories under `skills/`). This flag tells the installer which skill directory to install. Without it, the installer wouldn't know which of potentially many skills to use.

### 2. Run setup

```bash
cd ~/.agents/skills/atlassian-readonly
npm run setup
```

That single command stores your credentials in the OS credential store (Windows
Credential Manager, macOS Keychain, or Linux Secret Service; falling back to
`~/.config` token files where none exists), enables the corporate certificate store
if it detects TLS inspection, and verifies both tokens against the live API.
Nothing is installed first: the scripts use Node built-ins only, so the skill works
straight after step 1. Non-interactive:

```bash
npm run setup -- "you@example.com" "<jira-token>" "<confluence-token>"
```

Token creation and scope requirements are in
[skills/references/setup.md](skills/references/setup.md#create-api-tokens); the same file
covers rotation, headless/WSL setups, and troubleshooting.

### 3. Ask your agent

```text
Read HEC-123 and summarize its acceptance criteria.
Search Jira for open bugs assigned to me.
Search Confluence for pages about Kafka retry handling.
```

> 💡 **Finding space keys**: When searching Confluence, use the space key (not display name). Run `node ./skills/atlassian.mjs confluence search --cql 'title ~ "project-name"'` first to discover the correct space key from results.

---

## Direct Script Execution

For fast, token-efficient access, run the bundled script directly:

> 💡 **Corporate networks**: Prepend `NODE_OPTIONS="--use-system-ca"` for Zscaler/corporate TLS.

```bash
# Read a Jira issue
node ./skills/atlassian.mjs jira get-issue --issue-key HEC-123

# Search Jira with JQL
node ./skills/atlassian.mjs jira search-issues --jql 'project=HEC AND status=Open' --limit 10

# Read a Confluence page
node ./skills/atlassian.mjs confluence get-page --page-id 123456789

# Search Confluence with CQL
node ./skills/atlassian.mjs confluence search --cql 'title ~ "Kafka"' --limit 10
```

### Projections

Reduce response size with `--projection` (a JMESPath subset, no dependency needed):

```bash
node ./skills/atlassian.mjs jira search-issues \
  --jql 'project=HEC' \
  --projection 'issues[*].{key: key, summary: fields.summary, status: fields.status.name}'

node ./skills/atlassian.mjs confluence get-page \
  --page-id 123 \
  --projection 'title,body[storage].value'
```

JMESPath object shorthand `{key, summary}` is invalid — object entries need explicit
`name: expression` pairs, and nested fields must use their full path. Supported syntax is
`a.b.c`, `[0]`, `[-1]`, `["key"]`, `[*]`, `{k: expr}`, `|`, `@` and `length()`; filters,
slices and other functions are rejected with an explicit error.

### Any Other Read Endpoint

Use `get` for allowlisted GET paths the named commands do not cover:

```bash
node ./skills/atlassian.mjs jira get \
  --path '/rest/api/3/issue/HEC-123/changelog' --projection 'values[*].id'

node ./skills/atlassian.mjs confluence get \
  --path '/wiki/api/v2/pages' --query 'limit=5&sort=-created-date' --projection 'results[*].{t: title}'
```

### Validate Tokens

Check tokens before API calls to avoid wasted requests:

```bash
node ./skills/atlassian.mjs test jira   # exit 0 = valid, exit 1 = invalid
node ./skills/atlassian.mjs test confluence
```

---

## MCP Server

The bundled server exposes four tools via stdio:

| Tool ID | Description |
|---------|-------------|
| `jira_get_issue` | Read a single Jira issue |
| `jira_search_issues` | Search Jira with JQL |
| `confluence_get_page` | Read a Confluence page |
| `confluence_search` | Search Confluence with CQL |

### GitHub Copilot in VS Code

Run **MCP: Open User Configuration** from the Command Palette, then add:

```json
{
  "servers": {
    "atlassian-readonly": {
      "type": "stdio",
      "command": "node",
      "args": ["./skills/server.mjs"],
      "env": {
        "ATLASSIAN_USER_EMAIL": "your.email@example.com",
        "NODE_OPTIONS": "--use-system-ca"
      }
    }
  }
}
```

Reload VS Code, open Copilot Chat, select **Configure Tools**, and enable the four Atlassian tools.

### GitHub Copilot CLI

```bash
copilot mcp add atlassian-readonly \
  --env ATLASSIAN_USER_EMAIL="your.atlassian.email@example.com" \
  --env NODE_OPTIONS="--use-system-ca" \
  -- node ./skills/server.mjs
```

### Claude Code

Edit `~/.claude/mcp.json`:

```json
{
  "servers": {
    "atlassian-readonly": {
      "command": "node",
      "args": ["./skills/server.mjs"],
      "env": {
        "ATLASSIAN_USER_EMAIL": "your.email@example.com",
        "NODE_OPTIONS": "--use-system-ca"
      }
    }
  }
}
```

### Manual mcp.json

```bash
cp ./skills/references/mcp.json ~/.config/atlassian-readonly-mcp.json
```

Then update the `command` and `args` to point to your cloned repository.

---

## Create API Tokens

Open [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) and create **two separate tokens** (Jira and Confluence cannot share one).

### Jira token

```
read:jira-work
```

This classic scope alone is verified for issue retrieval and JQL search. Atlassian rejects granular Jira scopes with `401 Unauthorized; scope does not match`.

### Confluence token

```
read:page:confluence
read:content-details:confluence
search:confluence
```

These granular scopes are verified for CQL search and full page retrieval.

> ⚠️ Scopes are fixed at creation time. Copy each token immediately — the dialog won't show it again. Never place tokens in source files, config, shell history, issues, or chat.

---

## Store & Rotate Credentials

`npm run setup` stores credentials for you. To rotate or remove them afterwards:

```bash
npm run configure -- jira        # replace
npm run configure -- confluence  # replace
npm run configure -- jira delete # remove
npm run configure -- confluence delete
```

Tokens are saved in your OS credential store (Windows Credential Manager, macOS Keychain,
or Linux Secret Service), falling back to `~/.config/atlassian-<product>-token` with mode
`0600` where no credential store is reachable.

> ⚠️ Local deletion does not revoke the token at Atlassian. Revoke it separately from [Atlassian's token management page](https://id.atlassian.com/manage-profile/security/api-tokens).

---

## Troubleshooting

See [skills/references/setup.md](skills/references/setup.md#troubleshooting) for the full
list, including why a valid token can be reported as invalid and how to confirm which
credential source each product resolves from.

### Corporate certificates (Zscaler, etc.)

TLS inspection re-signs HTTPS traffic with a corporate CA. `npm run setup` detects this
and records it in the git-ignored `config.json`; force it with `npm run setup --
--system-ca`. Alternatively set `NODE_OPTIONS=--use-system-ca` (supported Node.js
versions).

Or export the non-expired corporate CA as Base-64 PEM and set `NODE_EXTRA_CA_CERTS` to its path. **Never** disable TLS verification.

### WSL

WSL uses a separate Linux trust store. Export the corporate root and intermediate certificates from Windows, save as `.crt`, then:

```bash
sudo cp *.crt /usr/local/share/ca-certificates/
sudo update-ca-certificates
```

Restart WSL before retrying HTTPS clients.

---

## WSL & Headless Systems

`npm run setup` writes `~/.config/atlassian-<product>-token` files (mode `0600`) when no
device credential store is reachable — no manual steps needed. To place them by hand:

```bash
mkdir -p ~/.config
install -m 600 /dev/null ~/.config/atlassian-user-email
install -m 600 /dev/null ~/.config/atlassian-jira-token
install -m 600 /dev/null ~/.config/atlassian-confluence-token
printf '%s' "your.email@example.com" > ~/.config/atlassian-user-email
read -rsp "Jira API token: " token; echo
printf '%s' "$token" > ~/.config/atlassian-jira-token
read -rsp "Confluence API token: " token; echo
printf '%s' "$token" > ~/.config/atlassian-confluence-token
unset token
```

Or set environment variables:

```bash
export ATLASSIAN_USER_EMAIL_FILE=~/.config/atlassian-user-email
export ATLASSIAN_JIRA_TOKEN_FILE=~/.config/atlassian-jira-token
export ATLASSIAN_CONFLUENCE_TOKEN_FILE=~/.config/atlassian-confluence-token
```

For process-scoped CI use, `ATLASSIAN_JIRA_API_TOKEN` and `ATLASSIAN_CONFLUENCE_API_TOKEN` are supported but should not be persisted in desktop configuration.

---

## Repository Layout

```
skills/
  SKILL.md            agent-facing instructions (kept short)
  references/setup.md detailed setup and troubleshooting
  setup.mjs           one-command setup + verification
  atlassian.mjs       CLI and the read-only operations
  jmespath.mjs        projection evaluator (no dependencies)
  server.mjs          MCP stdio server (needs npm install)
  credentials.mjs     credential resolution + config.json TLS
  wincred.mjs         Windows Credential Manager reads, no dependencies
  configure.mjs       interactive rotate/remove
  save-keyring-tokens.mjs
  scripts/check-tokens.sh  credential-store-free validator (curl)
  scripts/run.sh           TLS wrapper for atlassian.mjs
test/                 node:test suites
DEPENDENCIES.md       why the core has zero dependencies, and how to keep it that way
```

`npm run check` syntax-checks every entry point; `npm test` runs the unit tests; `npm run
setup -- --check` verifies live credentials without changing anything.

---

## Security

### Defense in depth

```
┌─────────────────────────────────────────────────────┐
│              YOUR REQUEST                            │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│  Layer 2: Implementation Enforcement                 │
│  • GET only, paths restricted to an allowlist        │
│  • No custom host or method                          │
│  • Response size-limited, secrets redacted           │
└──────────────┬──────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│  Layer 1: Token Scopes                               │
│  • Jira: read:jira-work                            │
│  • Confluence: read:page, read:content-details,     │
│    search:confluence                                 │
│  • Atlassian rejects any write attempt               │
└─────────────────────────────────────────────────────┘
```

**Key guarantees:**

- **No writes possible** — neither Atlassian nor this code allows write operations.
- **Allowlisted paths** — `--path` accepts only `/rest/api/3/...` and `/wiki/...` GETs.
- **Bounded responses** — size limits prevent excessive data exfiltration.
- **Secret redaction** — common credential patterns are masked in output.
- **Visibility inherited** — the runtime can only read content the token account can already access.

> ⚠️ Supplying a broader token weakens the token layer but does not enable write operations in this code.

See [SECURITY.md](SECURITY.md) for vulnerability reporting guidelines.

---

## License

> ⚠️ **Internal Use Only** — This software was developed on Toyota
> hardware during Toyota work hours. It is intended for use by Toyota
> employees only.
>
> **TODO:** Confirm the correct license and copyright holder with
> Toyota's internal IP/Legal team. The current LICENSE file may need
> updating.

[See LICENSE](LICENSE)
