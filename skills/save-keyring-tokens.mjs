#!/usr/bin/env node

// Non-interactive credential save, mainly for agents. `npm run setup` is the
// supported entry point and does the same work plus verification.
// Usage: node save-keyring-tokens.mjs <email> <jira-token> [confluence-token]

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { saveToken } from "./credentials.mjs";

if (process.argv.length < 4) {
  console.error("Usage: node save-keyring-tokens.mjs <email> <jira-token> [confluence-token]");
  process.exit(1);
}

const email = process.argv[2];
const jiraToken = process.argv[3];
const confluenceToken = process.argv[4];

if (!email || !jiraToken) {
  console.error("Email and Jira token are required.");
  process.exit(1);
}

for (const [product, token] of [["jira", jiraToken], ["confluence", confluenceToken]]) {
  if (!token) {
    continue;
  }
  const saved = await saveToken(product, token);
  // saveToken already names the store it used (Windows Credential Manager,
  // macOS Keychain, Secret Service, or a file path).
  console.log(`${product} token saved to ${saved}`);
}

// The credential store holds tokens only; the email is a plain config file.
const configDir = join(homedir(), ".config");
await mkdir(configDir, { recursive: true });
await writeFile(join(configDir, "atlassian-user-email"), email);

console.log(`Email saved: ${email}`);
console.log("Credentials configured.");
