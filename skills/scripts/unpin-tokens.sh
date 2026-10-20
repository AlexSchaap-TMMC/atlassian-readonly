#!/usr/bin/env bash
# Unpin machine-local token overrides so the OS credential store is authoritative.
#
# A pinned <product>TokenFile in config.json outranks the credential store by design
# (see DEPENDENCIES.md), which is what you want in CI but not on a workstation where
# Credential Manager holds the live token. This drops the pin and keeps TLS settings.
set -euo pipefail

config="${1:-$PWD/config.json}"

if [ ! -f "$config" ]; then
  echo "No config.json at $config — nothing to unpin; the credential store is already used." >&2
  exit 0
fi

echo "Before: $(cat "$config")"
node -e '
  const fs = require("fs");
  const path = process.argv[1];
  const config = JSON.parse(fs.readFileSync(path, "utf8"));
  delete config.jiraTokenFile;
  delete config.confluenceTokenFile;
  fs.writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
' "$config"
echo "After:  $(cat "$config")"
