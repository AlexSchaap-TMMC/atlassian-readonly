#!/usr/bin/env node

// One-shot setup: store credentials, enable corporate TLS where needed, and
// verify both tokens against the live API. The core CLI has no dependencies, so
// nothing here needs to install anything to work — see DEPENDENCIES.md.
//
//   npm run setup                                  interactive
//   npm run setup -- <email> <jira> [confluence]   non-interactive (agents, CI)
//   npm run setup -- --check                       verify only, change nothing
//   npm run setup -- --system-ca                   force-enable corporate TLS
//   npm run setup -- --with-deps                   also install MCP/optional deps
//
// Exit 0 = configured and verified. Exit 1 = incomplete; stderr says what is missing.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stdin, stdout } from "node:process";
import { saveToken } from "./credentials.mjs";

const skillDir = dirname(fileURLToPath(import.meta.url));
const configPath = join(skillDir, "config.json");
const products = ["jira", "confluence"];

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const checkOnly = flags.has("--check");
const forceSystemCA = flags.has("--system-ca");
const withDeps = flags.has("--with-deps");

const readConfig = () =>
  existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};

function expandHome(path) {
  return path.replace(/^~(?=\/|\\)/, homedir());
}

function emailPath() {
  return expandHome(
    readConfig().userEmailFile ||
      process.env.ATLASSIAN_USER_EMAIL_FILE ||
      join(homedir(), ".config", "atlassian-user-email"),
  );
}

function existingEmail() {
  const file = emailPath();
  return existsSync(file) ? readFileSync(file, "utf8").trim() : null;
}

// Accept a token from a file too, so an agent can pass one without putting a
// secret in shell history or the process list.
function tokenFromEnvironment(product) {
  const upper = product.toUpperCase();
  const file = process.env[`ATLASSIAN_${upper}_TOKEN_FILE`];
  if (file && existsSync(expandHome(file))) {
    return readFileSync(expandHome(file), "utf8").trim() || null;
  }
  return process.env[`ATLASSIAN_${upper}_API_TOKEN`] || null;
}

// Only the MCP server and the two optional niceties need an install, so this is
// opt-in rather than a gate in front of every run.
function installDependencies() {
  stdout.write("Installing MCP and optional dependencies (npm install)...\n");
  execFileSync("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: skillDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

function prompt(label) {
  const terminal = createInterface({ input: stdin, output: stdout });
  return terminal.question(label, { hideEchoBack: !label.startsWith("Email") });
}

function openTokenPage(product) {
  const url = "https://id.atlassian.com/manage-profile/security/api-tokens";
  const [command, commandArgs] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    execFileSync(command, commandArgs, { stdio: "ignore" });
    stdout.write(`\nOpened your browser to create the ${product} token:\n  ${url}\n`);
  } catch {
    stdout.write(`\nOpen this URL to create the ${product} token:\n  ${url}\n`);
  }
  stdout.write(
    product === "jira"
      ? "  scope: read:jira-work\n"
      : "  scopes: read:page:confluence, read:content-details:confluence, search:confluence\n",
  );
  stdout.write("Copy the token immediately, then paste it below.\n\n");
}

// Only Node's system certificate store trusts a TLS-inspection proxy's CA, so
// compare the default store against the system store to decide if it is needed.
function detectSystemCA() {
  const probe = (useSystemCA) => {
    try {
      execFileSync(
        process.execPath,
        [
          ...(useSystemCA ? ["--use-system-ca"] : []),
          "--unhandled-rejections=strict",
          "-e",
          "fetch('https://api.atlassian.com',{signal:AbortSignal.timeout(8000)}).catch(e=>{const t=String(e?.cause?.code||'')+(e?.message||'');process.exit(/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO|unable to verify|self signed/i.test(t)?3:0)}) ",
        ],
        { stdio: "ignore", timeout: 30_000 },
      );
      return 0;
    } catch (error) {
      return error.status ?? 1;
    }
  };

  if (probe(true) === 1) {
    return false; // this Node build has no --use-system-ca support
  }
  return probe(false) === 3 && probe(true) === 0;
}

function ensureTlsConfig() {
  const config = readConfig();
  if (config.useSystemCA === true) {
    stdout.write("TLS: system certificate store already enabled\n");
    return;
  }
  const needed = forceSystemCA || detectSystemCA();
  writeFileSync(
    configPath,
    JSON.stringify({ ...config, useSystemCA: needed }, null, 2) + "\n",
  );
  stdout.write(
    needed
      ? "TLS: enabled the system certificate store (corporate proxy detected)\n"
      : "TLS: default certificate store works, no override needed\n",
  );
}

function verify() {
  let allValid = true;
  for (const product of products) {
    try {
      const out = execFileSync(
        process.execPath,
        [join(skillDir, "atlassian.mjs"), "test", product],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      stdout.write(out.replace(/\n$/, "") + "\n");
    } catch (error) {
      allValid = false;
      const detail = (error.stderr || error.message)
        .split("\n")
        .filter((line) => line.trim() && !/warning/i.test(line))
        .join(" ");
      stdout.write(`Token invalid for ${product}: ${detail}\n`);
    }
  }
  return allValid;
}

async function main() {
  if (checkOnly) {
    stdout.write(
      `Email: ${existingEmail() || process.env.ATLASSIAN_USER_EMAIL || "not set"}\n`,
    );
    return verify() ? 0 : 1;
  }

  let email = args[0] || process.env.ATLASSIAN_USER_EMAIL || existingEmail();
  if (!email) {
    if (!stdin.isTTY) {
      throw new Error(
        "Email required: npm run setup -- <email> <jira-token> [confluence-token]",
      );
    }
    email = (await prompt("Email: ")).trim();
  }

  const supplied = { jira: args[1], confluence: args[2] };
  for (const product of products) {
    let token =
      supplied[product] || tokenFromEnvironment(product) || null;
    if (!token && !stdin.isTTY) {
      // Headless and unattended: jira is mandatory, confluence is optional.
      if (product === "confluence") {
        continue;
      }
      throw new Error(
        `No ${product} token supplied: npm run setup -- <email> <jira-token> [confluence-token]`,
      );
    }
    if (!token) {
      openTokenPage(product);
      token = (await prompt(`${product} API token: `)).trim();
      if (!token) {
        throw new Error(`${product} token cannot be empty.`);
      }
    }
    stdout.write(`${product}: saved to ${await saveToken(product, token)}\n`);
  }

  if (email) {
    writeFileSync(emailPath(), email);
    stdout.write(`Email saved: ${email}\n`);
  }

  ensureTlsConfig();

  if (withDeps) {
    installDependencies();
  }

  stdout.write("\n");
  if (!verify()) {
    throw new Error("Setup incomplete: see references/setup.md#troubleshooting");
  }
  stdout.write("\nAtlassian read-only skill is ready.\n");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error.message);
    process.exit(1);
  },
);
