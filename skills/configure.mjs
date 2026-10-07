#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { execSync } from "node:child_process";
import { deleteToken } from "./credentials.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const product = process.argv[2];
const command = process.argv[3] || "set";

if (!["jira", "confluence"].includes(product) || !["set", "delete"].includes(command)) {
  throw new Error(
    "Usage: npm run configure -- <jira|confluence> [set|delete]",
  );
}
if (command === "delete") {
  deleteToken(product);
  stdout.write(`Deleted the ${product} token from the OS credential store.\n`);
  process.exit(0);
}

if (!stdin.isTTY) {
  throw new Error("Credential setup requires an interactive terminal");
}

// Open the token generation page in the default browser
const tokenUrl = "https://id.atlassian.com/manage-profile/security/api-tokens";
try {
  const platform = process.platform;
  let openCmd;
  if (platform === "win32") {
    openCmd = `start "" "${tokenUrl}"`;
  } else if (platform === "darwin") {
    openCmd = `open "${tokenUrl}"`;
  } else {
    openCmd = `xdg-open "${tokenUrl}"`;
  }
  execSync(openCmd, { stdio: "ignore" });
  stdout.write(`\nOpened your browser for API token generation:\n  ${tokenUrl}\n`);
} catch {
  stdout.write(`\nCould not open browser. Manually visit:\n  ${tokenUrl}\n`);
}

stdout.write(`\nInstructions:\n`);
if (product === "jira") {
  stdout.write(`  1. Click "Create API token"\n`);
  stdout.write(`  2. Name it (e.g., "atlassian-readonly-jira")\n`);
  stdout.write(`  3. Scope: read:jira-work\n`);
  stdout.write(`  4. Copy the token and paste it below\n\n`);
} else {
  stdout.write(`  1. Click "Create API token"\n`);
  stdout.write(`  2. Name it (e.g., "atlassian-readonly-confluence")\n`);
  stdout.write(`  3. Scopes: read:page:confluence, read:content-details:confluence, search:confluence\n`);
  stdout.write(`  4. Copy the token and paste it below\n\n`);
}

const terminal = createInterface({ input: stdin, output: stdout });
const token = await terminal.question(`${product} API token: `, {
  hideEchoBack: true,
});
terminal.close();

if (!token.trim()) {
  throw new Error("API token cannot be empty");
}

// Delegate to save-keyring-tokens.mjs for the actual save operation
const saveScript = join(__dirname, "save-keyring-tokens.mjs");
const email = process.env.ATLASSIAN_USER_EMAIL || "";

try {
  execSync(
    `node "${saveScript}" "${email}" "${token.trim()}"`,
    { stdio: "inherit" }
  );
  stdout.write(`\n${product} token saved.\n`);
} catch (err) {
  console.error("Failed to save token:", err.message);
  process.exit(1);
}
