# Dependency policy

The CLI must work straight after `npx skills add`, with no install step. That
means the code paths an agent uses cannot import anything from `node_modules`.

Non-negotiable rules:

- `atlassian.mjs`, `credentials.mjs`, `jmespath.mjs`, `wincred.mjs` and
  `scripts/*` import only Node builtins and each other. `npm test` must pass with
  `node_modules` deleted — that is the actual gate, not an opinion.
- Anything else is an optional or platform dependency, loaded with a dynamic
  `import()` inside a `try`, and must degrade rather than fail.

## Dependency table

| Package | Status | Used by | Behaviour when absent |
|---|---|---|---|
| — (core) | required, zero packages | `atlassian.mjs` | n/a |
| `./jmespath.mjs` | internal module | `atlassian.mjs` | n/a, always present |
| `./wincred.mjs` | internal module | `credentials.mjs` | n/a, always present |
| `turndown` | optional | `atlassian.mjs` `get-page` | page body returned as raw storage HTML |
| `@napi-rs/keyring` | optional | `credentials.mjs` | skipped; the platform credential tool or `~/.config` file is used |
| `@modelcontextprotocol/server` | MCP only | `server.mjs` | CLI unaffected; `npm start` needs `npm install` |
| `zod` | MCP only | `server.mjs` | as above |

`@napi-rs/keyring` is a native module with twelve platform binaries and is the
slowest part of any install on this network. It is a fallback only: on Windows the
secret is read through `CredRead`, on macOS through `security`, and on Linux
through `secret-tool`, all with no install.

## Install paths

| Situation | What happens |
|---|---|
| `npx skills add` | nothing installed, `atlassian.mjs` and `setup.mjs` run immediately |
| `npm run setup` | verifies credentials; installs dependencies only on request |
| `npm install` (repo root) | installs MCP deps so `npm start` works |

## Verifying the policy

```bash
mv skills/node_modules skills/_node_modules && npm test; \
  mv skills/_node_modules skills/node_modules
```

`npm test` passing there is the proof. Also check the CLI directly:

```bash
node skills/atlassian.mjs test jira
node skills/atlassian.mjs jira search-issues --jql 'issuetype = Bug' --limit 1 \
  --projection 'issues[*].{key: key, summary: fields.summary}'
```

Both must succeed with no `node_modules` present.

## Adding a dependency

Ask whether the feature can degrade instead. If a package is genuinely needed:

1. Add it to `optionalDependencies`, never `dependencies`, unless it is MCP-only.
2. Import it dynamically inside `try` and define the degraded behaviour.
3. Document that behaviour in the table above.
4. Confirm `npm test` still passes with `node_modules` removed.

`server.mjs` is exempt: the MCP server is an explicit install-and-run tool, and its
imports may stay static.
