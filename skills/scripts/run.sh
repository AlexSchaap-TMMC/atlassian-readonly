#!/usr/bin/env bash
# Wrapper for atlassian.mjs — applies the machine-local TLS setting from config.json.
#
# The Node entry point applies the same setting on its own, so this wrapper only
# matters when you invoke `node atlassian.mjs` through a shell and want the flag in
# the environment for child processes too.
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
config="$script_dir/config.json"

if [ -f "$config" ]; then
  if node -e "
    const c = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
    process.exit(c.useSystemCA ? 0 : 1)
  " "$config"; then
    export NODE_OPTIONS="${NODE_OPTIONS:-} --use-system-ca"
  fi
fi

exec node "$script_dir/atlassian.mjs" "$@"
