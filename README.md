# Atlassian Read-only MCP

A small MCP server that gives AI assistants read-only access to Jira and
Confluence Cloud. Read-only access is enforced in two layers:

1. The Atlassian tokens contain only read scopes.
2. The server implements only allowlisted GET requests.

It exposes four tools:

- Read a Jira issue
- Search Jira with JQL
- Read a Confluence page
- Search Confluence with CQL

There is no generic HTTP tool and no POST, PUT, PATCH, or DELETE implementation.
Even if broader credentials were accidentally supplied, MCP clients would
still have no tool for changing Jira or Confluence content. Responses are
bounded, likely secrets are redacted, Confluence storage HTML is converted to
Markdown, and optional JMESPath projections can reduce returned data.

## Requirements

- Node.js 20 or newer
- Access to the configured Atlassian Cloud tenant
- Separate scoped API tokens for Jira and Confluence
- An MCP client such as GitHub Copilot in VS Code

## Install

```powershell
git clone https://github.com/AlexSchaap-TMMC/atlassian-readonly-mcp.git C:\Tools\atlassian-readonly
Set-Location C:\Tools\atlassian-readonly
npm ci
npm test
```

## Install the agent skill

The skill provides agent instructions; install the runtime separately:

```powershell
npx skills add AlexSchaap-TMMC/atlassian-readonly-mcp --skill atlassian-readonly
```

Clone and install the runtime as described above, then set
`ATLASSIAN_READONLY_HOME` to that checkout's path in the shell or agent
environment. The skill uses that variable to locate the scripts and MCP server.

## Create API tokens

Open [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
and create two tokens.

**Jira token**

```text
read:jira-work
```

This classic scope alone is verified for issue retrieval and JQL search.
Atlassian rejected Jira tokens containing only the equivalent granular scopes
with `401 Unauthorized; scope does not match`.

**Confluence token**

```text
read:page:confluence
read:content-details:confluence
search:confluence
```

These granular scopes are verified for CQL search and full page retrieval.

Scopes are fixed when a token is created. Jira and Confluence require separate
tokens. Copy each token from its one-time creation dialog and do not place it
in source files, MCP configuration, shell history, issues, or chat.

Do not add write or administration scopes. The restricted tokens ensure
Atlassian rejects write operations independently of the MCP implementation.

## Store credentials

From the repository directory:

```powershell
npm run configure -- jira
npm run configure -- confluence
```

The hidden prompts save each token separately in Windows Credential Manager,
macOS Keychain, or Linux Secret Service. The Atlassian account email belongs
in the MCP environment, not the credential store.

## Configure GitHub Copilot in VS Code

Run **MCP: Open User Configuration** from the Command Palette:

```json
{
  "servers": {
    "atlassian-readonly": {
      "type": "stdio",
      "command": "node",
      "args": ["C:\\Tools\\atlassian-readonly\\src\\server.mjs"],
      "env": {
        "ATLASSIAN_USER_EMAIL": "your.atlassian.email@example.com",
        "NODE_OPTIONS": "--use-system-ca"
      }
    }
  }
}
```

Reload VS Code, open Copilot Chat, select **Configure Tools**, and enable the
four Atlassian tools.

Example prompts:

```text
Read HEC-123 and summarize its acceptance criteria.
Search Jira for open bugs assigned to me.
Search Confluence for pages about Kafka retry handling.
```

## Configure GitHub Copilot CLI

```powershell
copilot mcp add atlassian-readonly `
  --env ATLASSIAN_USER_EMAIL="your.atlassian.email@example.com" `
  --env NODE_OPTIONS="--use-system-ca" `
  -- node C:\Tools\atlassian-readonly\src\server.mjs
```

Restart Copilot CLI after adding or changing the server.

## Troubleshooting

### Authentication

Check that:

- The email matches the Atlassian account that created the tokens.
- The correct product token was stored.
- The token is current and the account can access the requested content.
- Jira uses `read:jira-work`, not only granular Jira scopes.
- Confluence has all three scopes listed above.
- The MCP host was restarted after replacing a token.

Scoped tokens must use Atlassian's product gateways:

```text
https://api.atlassian.com/ex/jira/{cloudId}
https://api.atlassian.com/ex/confluence/{cloudId}
```

This server uses the fixed tenant Cloud ID in `scripts/atlassian.mjs`.

### Corporate certificates

TLS-inspection products such as Zscaler re-sign HTTPS traffic with a corporate
certificate authority. Windows may trust that authority while Node.js still
uses its bundled CA list. On supported Node.js versions, keep this in the MCP
environment:

```text
NODE_OPTIONS=--use-system-ca
```

If necessary, export the non-expired corporate CA as Base-64 PEM and set
`NODE_EXTRA_CA_CERTS` to its absolute path. Never disable TLS verification.

WSL has a separate Linux trust store. Export the applicable corporate root and
intermediate certificates from Windows, save them with `.crt` extensions, copy
them to `/usr/local/share/ca-certificates/`, then run:

```bash
sudo update-ca-certificates
```

Restart WSL before retrying `curl`, Docker, Node.js, or other HTTPS clients.

## WSL and headless systems

If no desktop keyring is available, use restricted token files:

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

Configure these variables in the MCP environment:

```text
ATLASSIAN_USER_EMAIL
ATLASSIAN_JIRA_TOKEN_FILE
ATLASSIAN_CONFLUENCE_TOKEN_FILE
```

`ATLASSIAN_JIRA_API_TOKEN` and `ATLASSIAN_CONFLUENCE_API_TOKEN` are supported
for process-scoped CI use, but should not be persisted in desktop
configuration.

## Rotate or remove credentials

Replace stored tokens:

```powershell
npm run configure -- jira
npm run configure -- confluence
```

Delete stored tokens:

```powershell
npm run configure -- jira delete
npm run configure -- confluence delete
```

Local deletion does not revoke a token. Revoke it separately from Atlassian's
token-management page.

## Security boundary

This project uses defense in depth:

- **Token enforcement:** the documented tokens contain only Atlassian read
  scopes, so Atlassian does not authorize writes.
- **Implementation enforcement:** only four narrow read tools are exposed.
  Their URLs and HTTP method are fixed; callers cannot choose another host,
  endpoint, or method.
- **Response controls:** responses are size-limited, likely secrets are
  redacted, and projections can minimize returned data.

Tokens still inherit the creator's visibility: the MCP can read only content
that account can already access. Supplying a broader token weakens the token
layer but does not add write operations to this server.

## License

[MIT](LICENSE)
