#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { deleteToken, saveToken } from "./credentials.mjs";

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

const terminal = createInterface({ input: stdin, output: stdout });
const token = await terminal.question(`${product} API token: `, {
  hideEchoBack: true,
});
terminal.close();

if (!token.trim()) {
  throw new Error("API token cannot be empty");
}

saveToken(product, token.trim());
stdout.write(
  `Saved the ${product} token in the OS credential store. Set ATLASSIAN_USER_EMAIL in the MCP environment.\n`,
);
