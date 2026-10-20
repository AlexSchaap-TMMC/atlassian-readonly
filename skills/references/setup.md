# Atlassian Read-only — Setup & Configuration

Detailed setup reference. The daily workflow needs only `npm run setup`; this file
covers token creation, scope requirements, storage backends, rotation, and
troubleshooting.

## Prerequisites

- Node.js 20 or newer
- Access to the configured Atlassian Cloud tenant
- Separate scoped API tokens for Jira and Confluence

## Install the Skill

```bash
npx skills add AlexSchaap-TMMC/atlassian-readonly --skill atlassian-readonly
```

Then run the single setup command from [SKILL.md](SKILL.md#setup). It installs
dependencies, stores credentials, enables corporate TLS when it detects a need, and
verifies both tokens against the live API. No other manual steps are required.

## Create API Tokens

Open [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
and create two tokens.

**Jira token** — scope: `read:jira-work`

**Confluence token** — scopes: `read:page:confluence`, `read:content-details:confluence`, `search:confluence`

Scopes are fixed at creation time. Copy each token immediately; the dialog will not show
it again.

## Where Credentials Are Stored

Resolution order per product:

1. Token file pinned in `config.json` (`<product>TokenFile`)
2. `ATLASSIAN_<PRODUCT>_API_TOKEN` environment variable
3. Device credential store: Windows Credential Manager, macOS Keychain, or Secret Service
4. `@napi-rs/keyring` entry `atlassian-readonly-mcp` / `toyota.atlassian.net:<product>`
   (only when the optional dependency is installed)
5. `~/.config/atlassian-<product>-token`

A pinned file or an explicit env token outranks the credential store on purpose:
that is how CI and one-off runs avoid a credential sitting in the workstation's
store. On a workstation you usually want the store to win, so drop the pins:

```bash
bash "$ATLAS_SKILL_DIR/scripts/unpin-tokens.sh"          # uses ./config.json
node "$ATLAS_SKILL_DIR/atlassian.mjs" test jira          # reports the source it used
```

The account email comes from `ATLASSIAN_USER_EMAIL`, then `userEmail` in `config.json`,
then `ATLASSIAN_USER_EMAIL_FILE`, then `~/.config/atlassian-user-email`.

`scripts/check-tokens.sh` exists for environments where the credential store is
unreachable, so it reads only environment variables and token files. If it disagrees with
`atlassian.mjs`, your credential store and token files hold different tokens — re-run
`npm run setup` to resync.

## Machine-Local Configuration

`config.json` in the skill directory is git-ignored machine-local state managed by
`npm run setup`. Copy `config.example.json` to `config.json` to set values by hand:

| Key | Purpose |
|-----|---------|
| `useSystemCA` | Use the OS certificate store (Zscaler and similar TLS inspection) |
| `jiraTokenFile` / `confluenceTokenFile` | Pin a token file; wins over the credential store. Unset on a workstation — see `scripts/unpin-tokens.sh` |
| `userEmailFile` | Explicit email file path |
| `userEmail` | Account email, used when no env var or email file exists |

## Interactive Configuration

```bash
npm run configure -- jira
npm run configure -- confluence
```

Rotate or remove:

```bash
npm run configure -- jira delete
npm run configure -- confluence delete
```

Local deletion does not revoke the token at Atlassian; revoke it from the token
management page.

## Validate Credentials

```bash
bash "$ATLAS_SKILL_DIR/scripts/check-tokens.sh" jira
node "$ATLAS_SKILL_DIR/atlassian.mjs" test confluence
```

Exit 0 = valid, exit 1 = invalid. Both probe a real read endpoint and check for the
expected `issues` / `results` array. `atlassian.mjs test` also prints which source the
token came from, which is how you tell a pin from a credential-store entry.

## Headless / WSL / Systems Without a Credential Store

`npm run setup` falls back to writing `~/.config/atlassian-<product>-token` with mode
`0600` automatically. To do it by hand:

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

## Troubleshooting

### Authentication

Check that:

- The email matches the Atlassian account that created the tokens.
- The correct product token was stored.
- The token is current and the account can access the requested content.
- Jira uses `read:jira-work` (not only granular scopes).
- Confluence has all three scopes listed above.
- The host was restarted after replacing a token.

### A valid token reported as invalid

`401 Unauthorized; scope does not match` does **not** always mean a bad token. This
tenant's OAuth-less API allowlist rejects `/rest/api/3/myself` with that message even
when the token is correctly scoped, so probing that endpoint yields a false negative.

Both validators probe real read endpoints instead — `/rest/api/3/search/jql` for Jira and
`/wiki/rest/api/search` for Confluence — and confirm the expected `issues` / `results`
array. If you still see a false negative:

1. Run both validators: `node atlassian.mjs test <product>` and
   `bash scripts/check-tokens.sh <product>`. They read from different sources, so a
   disagreement points at diverged credentials.
2. Re-run `npm run setup -- --check` to see which source each product resolves from.
3. Confirm validity with a real data call, which is the authoritative test:

```bash
node atlassian.mjs jira search-issues --jql 'project=<KEY> ORDER BY updated DESC' \
  --limit 3 --projection 'issues[*].{key: key, summary: fields.summary}'
```

On Windows, `python3` may resolve to the Microsoft Store stub alias, which exits
non-zero instead of parsing JSON. `check-tokens.sh` prefers `node` for response
validation and only falls back to a Python interpreter that actually runs.

### Corporate certificate reported as a token failure

```
TLS: the corporate certificate store is not in use, so the proxy's certificate cannot be verified.
```

Toyota's Zscaler tunnel (`ZSATunnel` on `127.0.0.1:9000`) re-signs TLS with a
`*.toyota.com` CA that lives in the Windows certificate store, not in Node's
bundled one. `--use-system-ca` selects the OS store, but Node reads it at process
startup, so a running process cannot enable it. `atlassian.mjs` therefore re-execs
itself once when `config.json` sets `useSystemCA`.

Two details that cost real debugging time here:

- **Node honours only one CA selector.** A preset `NODE_OPTIONS=--use-openssl-ca`
  combined with `--use-system-ca` leaves the *bundled* store active and every call
  fails. When the corporate store is wanted, it must be the only selector, and the
  code rewrites `NODE_OPTIONS` accordingly.
- **Probing an endpoint does not detect this.** `fetch('https://api.atlassian.com/')`
  returned 200 on this machine while real API calls failed on the certificate. So
  setup runs the actual verification first, and on a certificate error records
  `useSystemCA=true` and retries once, instead of guessing up front.

`NODE_TLS_REJECT_UNAUTHORIZED=0` was set in the environment of this session's
process tree and silently disabled certificate verification for every Node script
that inherited it, including this one. The code deletes it before any request.
It is not set at user or machine scope, so look for it in whatever launched the
agent if you see it elsewhere.

### JQL requires a bound

An unbounded JQL query is rejected by this tenant (the error text is returned in the
account locale, e.g. Chinese). Always send `maxResults` / `limit`; the bundled commands
set it for you.

### `statusCategory` returns nothing

`statusCategory=Open` returns 0 issues here even though statuses named `Open` exist, and
`openStatuses()` does too. Confirmed by direct API calls, so it is Atlassian-side, not a
bug in this skill. Use the issue status instead:

```bash
--jql 'project=HEC AND status="To Do"'      # works
--jql 'project=HEC AND statusCategory=Open' # returns 0
```

Categories themselves are queryable under their real names (`statusCategory="To Do"`,
`statusCategory=done`, `statusCategory=indeterminate`) — the word `Open` is simply not a
category this tenant resolves.

### JQL returns nothing for `statusCategory=Open`

`statusCategory=Open` returns 0 issues here even though statuses named `Open` exist, and
`openStatuses()` does too. Confirmed by direct API calls, so it is Atlassian-side, not a
bug in this skill. Use the issue status instead:

```bash
--jql 'project=HEC AND status="To Do"'      # works
--jql 'project=HEC AND statusCategory=Open' # returns 0
```

Categories are queryable under their real names (`statusCategory="To Do"`,
`statusCategory=done`, `statusCategory=indeterminate`) — `Open` is simply not a category
name this tenant resolves.

### Corporate certificates

TLS-inspection products (e.g., Zscaler) re-sign HTTPS traffic. `npm run setup` detects
this and sets `useSystemCA` in `config.json`, which makes the loaders add
`--use-system-ca` to `NODE_OPTIONS`. To set it manually:

```bash
npm run setup -- --system-ca
```

If necessary, export the non-expired corporate CA as Base-64 PEM and set
`NODE_EXTRA_CA_CERTS`. Never disable TLS verification.

WSL: Export the corporate root and intermediate certificates from Windows, save as `.crt`
in `/usr/local/share/ca-certificates/`, then run `sudo update-ca-certificates`.

## Security Notes

- This integration is **read-only only**. No write operations are implemented.
- Responses are size-limited to 1 MB.
- Secrets in responses are redacted (passwords, API keys, tokens).
- Tokens should have read-only scopes only.
- Tokens live in the OS credential store or `0600` files under `~/.config`, never in the
  skill directory or the repository.
