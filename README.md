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
- [Security](#security)
- [License](#license)

---

## Features

| Capability | Jira | Confluence |
|------------|------|------------|
| Read a single issue/page | ✅ `get-issue` | ✅ `get-page` |
| Search with query language | ✅ JQL | ✅ CQL |
| JMESPath projections | ✅ | ✅ |
| Response size limits | ✅ | ✅ |
| Secret redaction | ✅ | ✅ |
| HTML→Markdown conversion | — | ✅ |

**Four tools total** — only GET, no generic HTTP, no POST/PUT/PATCH/DELETE.

---

## Three Ways to Use

| Method | Best for | Setup |
|--------|----------|-------|
| **Agent Skill** | Casual queries via Claude/Copilot | `npx skills add ... --skill <name>` |
| **MCP Server** | Persistent tool integration in VS Code, CLI, Claude Code | Config file |
| **Direct Script** | Scripts, CI, token-efficient calls | `node atlassian.mjs ...` |

---

## Quick Start

### 1. Install the skill (recommended)

```bash
npx skills add AlexSchaap-TMMC/atlassian-readonly --skill atlassian-readonly
```

The `--skill` argument is required because the GitHub repository may contain multiple skills (multiple directories under `skills/`). This flag tells the installer which skill directory to install. Without it, the installer wouldn't know which of potentially many skills to use.

### 2. Clone and install

```bash
git clone https://github.com/AlexSchaap-TMMC/atlassian-readonly.git
cd atlassian-readonly
npm ci
```

### 3. Configure credentials

```bash
npm run configure -- jira
npm run configure -- confluence
export ATLASSIAN_USER_EMAIL="your.email@example.com"
```

### 4. Ask your agent

```text
Read HEC-123 and summarize its acceptance criteria.
Search Jira for open bugs assigned to me.
Search Confluence for pages about Kafka retry handling.
```

---

## Direct Script Execution

For fast, token-efficient access, run the bundled script directly:

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

### JMESPath Projections

Reduce response size with `--projection`:

```bash
node ./skills/atlassian.mjs jira search-issues \
  --jql 'project=HEC' \
  --projection 'issues[*].{key,summary,status.name}'

node ./skills/atlassian.mjs confluence get-page \
  --page-id 123 \
  --projection 'title,body[storage].value'
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
cp ./skills/references/atlassian-readonly-mcp.json ~/.config/atlassian-readonly-mcp.json
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

### Store tokens

```bash
npm run configure -- jira
npm run configure -- confluence
```

Tokens are saved in your OS credential store (Windows Credential Manager, macOS Keychain, or Linux Secret Service).

### Rotate tokens

```bash
npm run configure -- jira        # replace
npm run configure -- confluence  # replace
npm run configure -- jira delete # remove
npm run configure -- confluence delete
```

> ⚠️ Local deletion does not revoke the token at Atlassian. Revoke it separately from [Atlassian's token management page](https://id.atlassian.com/manage-profile/security/api-tokens).

---

## Troubleshooting

### Authentication fails

Verify:

- The email matches the Atlassian account that created the tokens.
- The correct product token was stored (Jira ≠ Confluence).
- The token is current and the account has access to the requested content.
- Jira uses `read:jira-work` (not granular scopes).
- Confluence has **all three** scopes listed above.
- The host was restarted after replacing a token.

### Corporate certificates (Zscaler, etc.)

TLS inspection re-signs HTTPS traffic with a corporate CA. On supported Node.js:

```bash
NODE_OPTIONS=--use-system-ca
```

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

Without a desktop keyring, use plain token files:

```bash
mkdir -p ~/.config
install -m 600 /dev/null ~/.config/atlassian-jira-token
install -m 600 /dev/null ~/.config/atlassian-confluence-token
read -rsp "Jira API token: " token; echo
printf '%s' "$token" > ~/.config/atlassian-jira-token
read -rsp "Confluence API token: " token; echo
printf '%s' "$token" > ~/.config/atlassian-confluence-token
unset token
```

Then set the environment variables:

```bash
export ATLASSIAN_USER_EMAIL="your.email@example.com"
export ATLASSIAN_JIRA_TOKEN_FILE=~/.config/atlassian-jira-token
export ATLASSIAN_CONFLUENCE_TOKEN_FILE=~/.config/atlassian-confluence-token
```

For process-scoped CI use, `ATLASSIAN_JIRA_API_TOKEN` and `ATLASSIAN_CONFLUENCE_API_TOKEN` are supported but should not be persisted in desktop configuration.

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
│  • Only 4 hardcoded GET endpoints                    │
│  • No custom host, path, or method                   │
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
