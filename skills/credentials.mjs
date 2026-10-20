import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { windowsBackend } from "./wincred.mjs";

const run = promisify(execFile);

const service = "atlassian-readonly-mcp";
const products = new Set(["jira", "confluence"]);
const account = (product) => `toyota.atlassian.net:${product}`;

// Machine-local overrides (corporate TLS, explicit token paths). Never committed;
// see config.example.json for the schema and .gitignore for the exclusion.
const skillDir = dirname(fileURLToPath(import.meta.url));
const configPath = join(skillDir, "config.json");
const localConfig = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, "utf8"))
  : {};

// Corporate proxies (Zscaler, Toyota ITx) re-sign TLS with a CA that is in the OS
// store but not in Node's bundled one, so those connections need
// --use-system-ca. That flag is fixed at process startup and cannot be turned on
// from inside a running process — setting NODE_OPTIONS here has no effect on the
// current one. Only a CLI launcher re-execs (see atlassian.mjs); library importers
// such as server.mjs read the intent from here and pass the flag to children.
export const systemCARequested = Boolean(
  localConfig.useSystemCA || process.env.ATLASSIAN_FORCE_SYSTEM_CA === "1",
);
export const systemCAActive = process.execArgv.includes("--use-system-ca");

// Certificate verification is never optional. An inherited
// NODE_TLS_REJECT_UNAUTHORIZED=0 — left behind by some debug wrapper — silently
// accepts a proxy's forged certificate. Never let it reach a request.
const rejectOffAtStartup = process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0";
if (rejectOffAtStartup) {
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
}

// Node reads NODE_OPTIONS at startup and honours only one CA selector. Inheriting
// a preset `--use-openssl-ca` together with our `--use-system-ca` on the command
// line leaves the bundled store active and every call fails on the certificate, so
// when the corporate store is wanted it must be the single selector in effect.
function caSelector(value) {
  if (!value) {
    return null;
  }
  return value
    .split(/\s+/)
    .filter((f) => f === "--use-system-ca" || f === "--use-openssl-ca");
}

function applySystemCA(env) {
  const others = (env.NODE_OPTIONS || "")
    .split(/\s+/)
    .filter((f) => f && f !== "--use-system-ca" && f !== "--use-openssl-ca");
  env.NODE_OPTIONS = ["--use-system-ca", ...others].join(" ").trim();
  return env;
}

// Used by CLI entry points, which may re-exec exactly once.
export function needsReexec() {
  if (
    !((systemCARequested && !systemCAActive) || rejectOffAtStartup) ||
    process.env.ATLASSIAN_TLS_REEXEC === "1"
  ) {
    return false;
  }
  // Nothing to gain if the store is already the effective selector.
  return !(systemCARequested && caSelector(process.env.NODE_OPTIONS)?.[0] === "--use-system-ca");
}

// Re-run this process with the flags in place, once. Returns the child's exit
// code; the caller must exit with it. stdio is piped rather than inherited so a
// parent collecting stdout keeps the child's real result.
export function reexecForTls() {
  const env = { ...process.env, ATLASSIAN_TLS_REEXEC: "1" };
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (systemCARequested) {
    applySystemCA(env);
  }
  const result = spawnSync(
    process.execPath,
    [...process.execArgv, ...process.argv.slice(1)],
    { encoding: "utf8", env },
  );
  if (result.error) {
    return null; // re-exec unavailable; caller continues without the flag
  }
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  return result.status ?? 1;
}

function assertProduct(product) {
  if (!products.has(product)) {
    throw new Error(`Unsupported Atlassian product: ${product}`);
  }
}

function upper(product) {
  return product.toUpperCase();
}

const envTokenFor = (product) =>
  process.env[`ATLASSIAN_${upper(product)}_API_TOKEN`];

function expandHome(path) {
  return path.replace(/^~(?=\/|\\)/, homedir());
}

/* ------------------------------------------------------------------ *
 * TLS
 *
 * Shared by every entry point so a failed corporate-proxy connection reads as
 * one clear action instead of an undici stack trace.
 * ------------------------------------------------------------------ */

export function tlsGuidance(failure) {
  // Accepts a caught error or the Error from child_process.execFileSync, where
  // `code` is the exit status and the real reason only appears in stderr.
  const error = failure?.code instanceof Error ? failure.code : failure;
  const cause = error?.cause;
  const text = `${cause?.code || ""} ${error?.code || ""} ${failure?.stderr || ""} ${
    cause?.message || ""
  } ${error?.message || ""}`;
  if (
    /CERT|UNABLE_TO_VERIFY|SELF_SIGNED|DEPTH_ZERO|UNABLE_TO_GET_ISSUER/i.test(
      `${cause?.code || ""} ${error?.code || ""} ${failure?.stderr || ""}`,
    ) ||
    /unable to (get|verify)[^\n]*certificate/i.test(text)
  ) {
    const selector = caSelector(process.env.NODE_OPTIONS)?.[0];
    return (
      "TLS: the corporate certificate store is not in use, so the proxy's " +
      "certificate cannot be verified.\n" +
      "  Fix: npm run setup -- --system-ca   (or set useSystemCA in config.json)" +
      (selector && selector !== "--use-system-ca"
        ? `\n  Note: NODE_OPTIONS pins ${selector}; the corporate store needs --use-system-ca.`
        : "") +
      (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
        ? "\n  Note: NODE_TLS_REJECT_UNAUTHORIZED=0 is set and is ignored by design."
        : "")
    );
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Credential stores
 *
 * Reading a token must not need third-party code: the platform's own credential
 * tool is called directly, and @napi-rs/keyring stays an optional fallback. That
 * is what lets a fresh clone work before any install.
 * ------------------------------------------------------------------ */

// macOS Keychain and freedesktop Secret Service speak through their CLI.
// Windows needs advapi32 (cmdkey cannot print a secret), see wincred.mjs.
const macBackend = {
  name: "macOS Keychain",
  async read(product) {
    const { stdout } = await run("security", [
      "find-generic-password",
      "-s",
      service,
      "-a",
      account(product),
      "-w",
    ]);
    return stdout.trim() || null;
  },
  async write(product, token) {
    // -U updates an existing entry instead of failing on a duplicate.
    await run("security", [
      "add-generic-password",
      "-U",
      "-s",
      service,
      "-a",
      account(product),
      "-w",
      token,
    ]);
  },
  async remove(product) {
    await run("security", [
      "delete-generic-password",
      "-s",
      service,
      "-a",
      account(product),
    ]);
  },
};

// `secret-tool store` reads the secret from a terminal, so writes go through the
// optional binding; reads need no dependency at all.
const secretToolBackend = {
  name: "Secret Service",
  async read(product) {
    const { stdout } = await run("secret-tool", [
      "lookup",
      "service",
      service,
      "username",
      account(product),
    ]);
    return stdout.trim() || null;
  },
  async remove(product) {
    await run("secret-tool", [
      "clear",
      "service",
      service,
      "username",
      account(product),
    ]);
  },
};

const windowsAdapter = {
  name: windowsBackend.name,
  read: (product) => windowsBackend.read(account(product)),
  write: (product, token) =>
    windowsBackend.write(account(product), account(product), token),
  remove: (product) => windowsBackend.remove(account(product)),
};

// `store` names a backend that can write; read-only backends return null there.
function nativeBackend() {
  switch (process.platform) {
    case "win32":
      return windowsAdapter;
    case "darwin":
      return macBackend;
    case "linux":
      return secretToolBackend;
    default:
      return null;
  }
}

let napiEntry;
async function napiEntryClass() {
  if (napiEntry === undefined) {
    try {
      ({ Entry: napiEntry } = await import("@napi-rs/keyring"));
    } catch {
      napiEntry = null;
    }
  }
  return napiEntry;
}

async function readKeyring(product) {
  const Entry = await napiEntryClass();
  if (!Entry) {
    return null;
  }
  try {
    return (await new Entry(service, account(product)).getPassword()) || null;
  } catch {
    return null;
  }
}

async function readTokenFile(path) {
  const resolved = expandHome(path);
  try {
    return (await readFile(resolved, "utf8")).trim() || null;
  } catch {
    return null;
  }
}

async function loadEmail() {
  const emailFile = expandHome(
    localConfig.userEmailFile ||
      process.env.ATLASSIAN_USER_EMAIL_FILE ||
      "~/.config/atlassian-user-email",
  );
  try {
    return (await readFile(emailFile, "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
}

// Resolution order: pinned file, env token, native credential store, optional
// binding, standard file. A pinned file or an explicit env token is authoritative,
// which is how CI and a one-off run avoid reading a credential that happens to sit
// in the workstation's store.
// Returns `{ token, source }` so callers can report which store answered.
async function loadToken(product) {
  const envToken = process.env[`ATLASSIAN_${upper(product)}_API_TOKEN`];
  const explicitFile =
    localConfig[`${product}TokenFile`] ||
    process.env[`ATLASSIAN_${upper(product)}_TOKEN_FILE`];
  if (explicitFile) {
    const token = await readTokenFile(explicitFile);
    if (token) {
      return { token, source: explicitFile };
    }
  }
  if (envToken) {
    return { token: envToken, source: "environment" };
  }

  const backend = nativeBackend();
  if (backend) {
    try {
      const token = await backend.read(product);
      if (token) {
        return { token, source: backend.name };
      }
    } catch {
      // Tool missing or nothing stored: fall through to the next source.
    }
  }

  const binding = await readKeyring(product);
  if (binding) {
    return { token: binding, source: "OS credential store" };
  }

  const standard = `~/.config/atlassian-${product}-token`;
  const token = await readTokenFile(standard);
  return token ? { token, source: standard } : null;
}

export async function loadCredentials(product) {
  assertProduct(product);

  const email =
    process.env.ATLASSIAN_USER_EMAIL ||
    localConfig.userEmail ||
    (await loadEmail());
  const resolved =
    (await loadToken(product)) ||
    (envTokenFor(product)
      ? { token: envTokenFor(product), source: "environment" }
      : null);

  if (!email || !resolved) {
    throw new Error(
      `${product} credentials not found.\n` +
        `  email: ${email ? "found" : "missing \u2014 set ATLASSIAN_USER_EMAIL or write ~/.config/atlassian-user-email"}\n` +
        `  token: ${resolved ? "found" : `missing \u2014 run 'npm run setup' or 'npm run configure -- ${product}'`}`,
    );
  }

  return { email, token: resolved.token, source: resolved.source };
}

// Returns a human-readable description of where the token ended up.
export async function saveToken(product, token) {
  assertProduct(product);
  const backend = nativeBackend();
  if (backend?.write) {
    try {
      await backend.write(product, token);
      return backend.name;
    } catch {
      // Fall through to the optional binding, then to a private file.
    }
  }

  const Entry = await napiEntryClass();
  if (Entry) {
    try {
      await new Entry(service, account(product)).setPassword(token);
      return "OS credential store";
    } catch {
      // Fall through to the file backend.
    }
  }

  const file = expandHome(`~/.config/atlassian-${product}-token`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, token, { mode: 0o600 });
  return file;
}

export async function deleteToken(product) {
  assertProduct(product);
  const backend = nativeBackend();
  if (backend?.remove) {
    await backend.remove(product).catch(() => {});
  }
  const Entry = await napiEntryClass();
  if (Entry) {
    await new Entry(service, account(product)).deletePassword().catch(() => {});
  }
}
