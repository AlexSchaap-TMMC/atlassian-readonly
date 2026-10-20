import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
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

if (localConfig.useSystemCA) {
  // Re-exec with the corporate root store (Zscaler and friends re-sign TLS).
  process.env.NODE_OPTIONS =
    (process.env.NODE_OPTIONS || "") + " --use-system-ca";
}

function assertProduct(product) {
  if (!products.has(product)) {
    throw new Error(`Unsupported Atlassian product: ${product}`);
  }
}

function upper(product) {
  return product.toUpperCase();
}

function expandHome(path) {
  return path.replace(/^~(?=\/|\\)/, homedir());
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

// Resolution order: pinned file, native credential store, optional binding,
// standard file. A pinned file is authoritative, which is how you avoid reading
// a different credential that happens to sit in the credential store.
async function loadToken(product) {
  const explicitFile =
    localConfig[`${product}TokenFile`] ||
    process.env[`ATLASSIAN_${upper(product)}_TOKEN_FILE`];
  if (explicitFile) {
    const token = await readTokenFile(explicitFile);
    if (token) {
      return token;
    }
  }

  const backend = nativeBackend();
  if (backend) {
    try {
      const token = await backend.read(product);
      if (token) {
        return token;
      }
    } catch {
      // Tool missing or nothing stored: fall through to the next source.
    }
  }

  return (await readKeyring(product)) ||
    readTokenFile(`~/.config/atlassian-${product}-token`);
}

export async function loadCredentials(product) {
  assertProduct(product);

  const email =
    process.env.ATLASSIAN_USER_EMAIL ||
    localConfig.userEmail ||
    (await loadEmail());
  const token =
    (await loadToken(product)) ||
    process.env[`ATLASSIAN_${upper(product)}_API_TOKEN`];

  if (!email || !token) {
    throw new Error(
      `${product} credentials not found.\n` +
        `  email: ${email ? "found" : "missing \u2014 set ATLASSIAN_USER_EMAIL or write ~/.config/atlassian-user-email"}\n` +
        `  token: ${token ? "found" : `missing \u2014 run 'npm run setup' or 'npm run configure -- ${product}'`}`,
    );
  }

  return { email, token };
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
