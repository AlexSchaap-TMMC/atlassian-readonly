import { readFile } from "node:fs/promises";
import { Entry } from "@napi-rs/keyring";

const service = "atlassian-readonly-mcp";
const products = new Set(["jira", "confluence"]);

function assertProduct(product) {
  if (!products.has(product)) {
    throw new Error(`Unsupported Atlassian product: ${product}`);
  }
}

export async function loadCredentials(product) {
  assertProduct(product);

  // Load email: env var > email file > error
  let email = process.env.ATLASSIAN_USER_EMAIL;
  const emailFile = process.env.ATLASSIAN_USER_EMAIL_FILE ?? "~/.config/atlassian-user-email";
  if (!email) {
    const { homedir } = await import("node:os");
    const resolved = emailFile.replace(/^~\//, homedir() + "/");
    try {
      email = (await readFile(resolved, "utf8")).trim();
    } catch {
      // file doesn't exist — fall through to error
    }
  }

  // Load token: keyring > token file > env var > error
  let token = new Entry(service, `toyota.atlassian.net:${product}`).getPassword();
  const file = process.env[`ATLASSIAN_${product.toUpperCase()}_TOKEN_FILE`];
  if (!token && file) {
    token = (await readFile(file, "utf8")).trim();
  }
  token ||= process.env[`ATLASSIAN_${product.toUpperCase()}_API_TOKEN`];

  if (!email || !token) {
    throw new Error(
      `Run 'npm run configure -- ${product}' or configure the ${product} token file`,
    );
  }

  return { email, token };
}

export function saveToken(product, token) {
  assertProduct(product);
  new Entry(service, `toyota.atlassian.net:${product}`).setPassword(token);
}

export function deleteToken(product) {
  assertProduct(product);
  new Entry(service, `toyota.atlassian.net:${product}`).deletePassword();
}
