import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../skills/atlassian.mjs", import.meta.url));

// These run the real CLI in a child process because TLS flags and credential
// precedence are fixed at process startup or depend on machine-local state —
// neither can be exercised reliably in-process.
function runCli(args, env = {}) {
  try {
    return {
      status: 0,
      stdout: execFileSync(process.execPath, [cli, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...cleanEnv(), ...env },
      }),
      stderr: "",
    };
  } catch (error) {
    return {
      status: error.status,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
    };
  }
}

// config.json is machine-local and would decide the TLS path for every case here.
function cleanEnv() {
  const env = { ...process.env };
  delete env.ATLASSIAN_FORCE_SYSTEM_CA;
  delete env.ATLASSIAN_TLS_REEXEC;
  delete env.NODE_TLS_REJECT_UNAUTHORIZED;
  delete env.NODE_OPTIONS;
  return env;
}

// config.json is machine-local and would decide the TLS path for every case here,
// so tests run against a temporary copy of the skill with no config present.
const skillDir = fileURLToPath(new URL("../skills", import.meta.url));
const realConfig = join(skillDir, "config.json");
const backupConfig = join(skillDir, "config.json.test-bak");

// config.json is machine-local and would decide the TLS path for every case here,
// so TLS cases run against the skill with no config present. node:test runs top-
// level tests in declaration order, so this fixture wraps the cases below it.
test("TLS cases run without machine-local config", (t) => {
  if (existsSync(realConfig)) {
    renameSync(realConfig, backupConfig);
  }
  t.after(() => {
    if (existsSync(backupConfig)) {
      renameSync(backupConfig, realConfig);
    }
  });

  t.test("certificate failures are reported as actionable guidance", () => {
    // No --use-system-ca and the bundled store cannot verify a TLS-inspection
    // proxy, so this must explain the fix rather than dump an undici stack trace.
    const result = runCli(["test", "jira"], {
      ATLASSIAN_USER_EMAIL: "user@example.com",
      ATLASSIAN_JIRA_API_TOKEN: "test-token",
      ATLASSIAN_TLS_REEXEC: "1",
      NODE_OPTIONS: "",
    });
    const output = result.stdout + result.stderr;
    if (!/unable to get local issuer|self[- ]signed|unable to verify/i.test(output)) {
      // Host without TLS interception: nothing to assert about guidance.
      return;
    }
    assert.match(output, /corporate certificate store/i);
    assert.match(output, /--system-ca/);
    assert.doesNotMatch(output, /Error\.captureStackTrace/);
    assert.equal(result.status, 1);
  });

  t.test("NODE_TLS_REJECT_UNAUTHORIZED=0 never disables verification", () => {
    // An inherited "0" would silently accept a proxy's forged certificate. The code
    // strips it, so on a TLS-inspecting host the call must still fail on the cert.
    const result = runCli(["test", "jira"], {
      ATLASSIAN_USER_EMAIL: "user@example.com",
      ATLASSIAN_JIRA_API_TOKEN: "test-token",
      ATLASSIAN_TLS_REEXEC: "",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      NODE_OPTIONS: "",
    });
    const output = result.stdout + result.stderr;
    if (!/unable to get local issuer|self[- ]signed|unable to verify/i.test(output)) {
      return; // host without TLS interception
    }
    assert.ok(
      !/Token valid/.test(output),
      "verification was bypassed: " + output.slice(0, 200),
    );
    assert.match(output, /corporate certificate store|certificate/i);
    assert.notEqual(result.status, 0);
  });
});

// Precedence must not depend on machine state, so supply the token explicitly.
process.env.ATLASSIAN_USER_EMAIL ||= "user@example.com";
process.env.ATLASSIAN_JIRA_API_TOKEN ||= "test-token";

// -e evaluates as CommonJS, so the import has to be dynamic, and Windows paths
// need file:// URLs to be importable.
const credentialsUrl = pathToFileURL(
  fileURLToPath(new URL("../skills/credentials.mjs", import.meta.url)),
).href;
const precedenceProbe = `
  const { loadCredentials } = await import(${JSON.stringify(credentialsUrl)});
  const c = await loadCredentials("jira");
  process.stdout.write(c.source);
`;

test("an explicit env token outranks the device credential store", () => {
  // CI and one-off runs must not silently use a workstation's stored credential.
  const out = execFileSync(process.execPath, ["-e", precedenceProbe], {
    encoding: "utf8",
    env: cleanEnv(),
  });
  assert.equal(out, "environment");
});

test("with no env token, resolution falls back to a stored credential", () => {
  // The other side of the precedence rule: removal must still find the store or
  // the standard file, not fail.
  const env = cleanEnv();
  delete env.ATLASSIAN_JIRA_API_TOKEN;
  let out;
  try {
    out = execFileSync(process.execPath, ["-e", precedenceProbe], { encoding: "utf8", env });
  } catch (error) {
    // A machine with neither a store entry nor a token file is a valid state for
    // this assertion; the resolution error proves the fallback was reached.
    assert.match(String(error.stderr || error.message), /credentials not found|source/i);
    return;
  }
  assert.ok(out, "expected a resolved source");
  assert.notEqual(out, "environment");
});

test("raw get rejects paths outside the read-only allowlist", () => {
  for (const path of ["/rest/api/2/issue/X", "/wiki/api/v2/../write", "https://evil.example/x"]) {
    const product = path.startsWith("/wiki") ? "confluence" : "jira";
    const result = runCli(["get", "--path", path], {
      ATLASSIAN_USER_EMAIL: "user@example.com",
      ATLASSIAN_JIRA_API_TOKEN: "test-token",
      ATLASSIAN_CONFLUENCE_API_TOKEN: "test-token",
    });
    // A path outside the family for its product, or with traversal, must not be sent.
    const output = result.stdout + result.stderr;
    if (/allowlist|must start with/.test(output)) {
      continue;
    }
    assert.ok(
      result.status !== 0,
      `expected rejection for ${path}, got: ${output.slice(0, 160)}`,
    );
  }
});
