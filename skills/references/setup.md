# Atlassian Read-only — Setup & Configuration

## Prerequisites

- Node.js 20 or newer
- Access to the configured Atlassian Cloud tenant
- Separate scoped API tokens for Jira and Confluence

## Install the Skill

The skill is installed automatically by `npx skills add`. Navigate to the installed directory and install dependencies:

```bash
cd "$HOME/.agents/skills/atlassian-readonly"
npm install
```

## Create API Tokens

Open [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) and create two tokens.

**Jira token** — scope: `read:jira-work`

**Confluence token** — scopes: `read:page:confluence`, `read:content-details:confluence`, `search:confluence`

## Store Credentials

Run the configure script for each product:

```bash
npm run configure -- jira
npm run configure -- confluence
```

The prompts save each token in the OS credential store (Windows Credential Manager, macOS Keychain, or Linux Secret Service).

Then set your Atlassian account email:

```bash
export ATLASSIAN_USER_EMAIL="your.atlassian.email@example.com"
```

## Headless / WSL / No-keyring Systems

Use token files instead:

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

Then configure environment variables:

```bash
export ATLASSIAN_USER_EMAIL="your.email@example.com"
export ATLASSIAN_JIRA_TOKEN_FILE=~/.config/atlassian-jira-token
export ATLASSIAN_CONFLUENCE_TOKEN_FILE=~/.config/atlassian-confluence-token
```

## Rotate or Remove Credentials

Replace stored tokens:

```bash
npm run configure -- jira
npm run configure -- confluence
```

Delete stored tokens:

```bash
npm run configure -- jira delete
npm run configure -- confluence delete
```

## Troubleshooting

### Authentication

Check that:

- The email matches the Atlassian account that created the tokens.
- The correct product token was stored.
- The token is current and the account can access the requested content.
- Jira uses `read:jira-work` (not only granular scopes).
- Confluence has all three scopes listed above.
- The host was restarted after replacing a token.

### Corporate certificates

TLS-inspection products (e.g., Zscaler) re-sign HTTPS traffic. On supported Node.js versions:

```text
NODE_OPTIONS=--use-system-ca
```

If necessary, export the non-expired corporate CA as Base-64 PEM and set `NODE_EXTRA_CA_CERTS`. Never disable TLS verification.

WSL: Export the corporate root and intermediate certificates from Windows, save as `.crt` in `/usr/local/share/ca-certificates/`, then run `sudo update-ca-certificates`.

## Security Notes

- This integration is **read-only only**. No write operations are implemented.
- Responses are size-limited to 1 MB.
- Secrets in responses are redacted (passwords, API keys, tokens).
- Tokens should have read-only scopes only.
