#!/usr/bin/env node

// Save Atlassian tokens to OS keyring (non-interactive)
// Usage: node save-keyring-tokens.mjs <email> <jira-token> [confluence-token]

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

// Save to OS keyring
try {
  saveToken("jira", jiraToken);
  console.log("Jira token saved to OS keyring.");
} catch (err) {
  console.error(`Failed to save Jira token: ${err.message}`);
  process.exit(1);
}

if (confluenceToken) {
  try {
    saveToken("confluence", confluenceToken);
    console.log("Confluence token saved to OS keyring.");
  } catch (err) {
    console.error(`Failed to save Confluence token: ${err.message}`);
    process.exit(1);
  }
}

// Save email to file (keyring doesn't store email)
import { writeFile } from "node:fs/promises";

const configDir = `${process.env.HOME}/.config`;
await writeFile(`${configDir}/atlassian-user-email`, email);

console.log(`Email saved: ${email}`);
console.log("Credentials configured via OS keyring.");
