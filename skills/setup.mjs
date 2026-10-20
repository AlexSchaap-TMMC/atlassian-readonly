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
import { saveToken, tlsGuidance } from "./credentials.mjs";

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

// Decided by evidence, not by probing an endpoint. A probe against
// api.atlassian.com succeeded here while real API calls still failed on the
// certificate, so probing gives false negatives. A certificate failure is
// instead caught during verification and recorded, then applied on the next run.
function enableSystemCA() {
  const config = readConfig();
  writeFileSync(
    configPath,
    JSON.stringify({ ...config, useSystemCA: true }, null, 2) + "\n",
  );
  // Read back through the same path credentials.mjs uses, so this process agrees
  // with any child it spawns.
  process.env.ATLASSIAN_FORCE_SYSTEM_CA = "1";
}

// One re-exec per command, requested through ATLASSIAN_TLS_REEXEC. A parent that
// already applies the flag sets it so a child does not repeat the round trip.
let tlsFailure = null;
const errorIsTls = (error) => Boolean(tlsGuidance(error));

// Effective NODE_OPTIONS for a child that must use the corporate store: exactly
// one CA selector, because Node honours only the first.
function childEnv() {
  const env = { ...process.env };
  if (readConfig().useSystemCA || forceSystemCA) {
    env.ATLASSIAN_TLS_REEXEC = "1";
    env.NODE_OPTIONS = ["--use-system-ca"]
      .concat(
        (env.NODE_OPTIONS || "")
          .split(/\s+/)
          .filter(
            (f) =>
              f && f !== "--use-system-ca" && f !== "--use-openssl-ca",
          ),
      )
      .join(" ");
  }
  return env;
}

function verify() {
  let allValid = true;
  tlsFailure = null;
  for (const product of products) {
    // Resolve per product: this loop starts before any child runs, so a value read
    // here would miss a useSystemCA the retry path has just recorded.
    const env = childEnv();
    let out;
    try {
      out = execFileSync(
        process.execPath,
        [join(skillDir, "atlassian.mjs"), "test", product],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env },
      );
    } catch (error) {
      const guidance = tlsGuidance(error);
      if (guidance) {
        // Keep the error so a caller can tell a certificate problem apart from a
        // bad token; the child's own message below is a different failure.
        tlsFailure = error;
        stdout.write(`TLS failure for ${product}: ${guidance}\n`);
        continue;
      }
      allValid = false;
      // The child already prints "Token invalid for <product>: ..."; relay it
      // rather than wrapping it in a second prefix.
      const detail = (error.stdout || error.stderr || error.message)
        .split("\n")
        .filter((line) => line.trim() && !/warning/i.test(line))
        .join(" ");
      stdout.write(detail + "\n");
      continue;
    }
    stdout.write(String(out).replace(/\n$/, "") + "\n");
  }
  return allValid;
}

async function main() {
  // A certificate failure is decided by evidence, not by probing an endpoint: a
  // probe against api.atlassian.com succeeds here even while real API calls fail on
  // the certificate. So run the real calls, and if the corporate store was the
  // blocker, record it and retry once.
  if (forceSystemCA) {
    enableSystemCA();
    stdout.write("TLS: using the system certificate store\n");
  } else if (readConfig().useSystemCA) {
    stdout.write("TLS: using the system certificate store (from config.json)\n");
  }

  if (checkOnly) {
    stdout.write(
      `Email: ${existingEmail() || process.env.ATLASSIAN_USER_EMAIL || "not set"}\n`,
    );
    const first = verify();
    if (errorIsTls(tlsFailure) && !readConfig().useSystemCA) {
      enableSystemCA();
      stdout.write(
        "\nCertificate failure: recorded useSystemCA=true and retrying once.\n",
      );
      verify();
      if (!errorIsTls(tlsFailure)) {
        // The blocker was the certificate store, now fixed and confirmed.
        return 0;
      }
      stdout.write(`\n${tlsGuidance(tlsFailure)}\n`);
      return 1;
    }
    if (errorIsTls(tlsFailure)) {
      stdout.write(`\n${tlsGuidance(tlsFailure)}\n`);
      return 1;
    }
    return first ? 0 : 1;
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

  if (withDeps) {
    installDependencies();
  }

  stdout.write("\n");
  if (!verify()) {
    if (errorIsTls(tlsFailure) && !readConfig().useSystemCA) {
      enableSystemCA();
      stdout.write(
        "\nCertificate failure: recorded useSystemCA=true and retrying once.\n",
      );
      if (verify() && !errorIsTls(tlsFailure)) {
        stdout.write("\nAtlassian read-only skill is ready.\n");
        return 0;
      }
    }
    if (errorIsTls(tlsFailure)) {
      stdout.write(`\n${tlsGuidance(tlsFailure)}\n`);
    }
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
