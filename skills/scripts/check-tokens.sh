#!/usr/bin/env bash
# check-tokens.sh — Lightweight token validity check using curl.
# Reads tokens from env vars or token files (no keyring dependency).
# Exit 0 = valid, 1 = invalid/error.
#
# Usage:
#   bash "$ATLAS_SKILL_DIR/scripts/check-tokens.sh" [jira|confluence]
#   ATLASSIAN_USER_EMAIL=foo@bar.com bash "$ATLAS_SKILL_DIR/scripts/check-tokens.sh"
#   ATLASSIAN_USER_EMAIL=foo@bar.com ATLASSIAN_JIRA_TOKEN_FILE=~/.config/jira-token bash "$ATLAS_SKILL_DIR/scripts/check-tokens.sh" jira

set -euo pipefail

PRODUCT="${1:-jira}"
VALID_PRODUCTS="jira confluence"

if ! echo "$VALID_PRODUCTS" | grep -qw "$PRODUCT"; then
  echo "Usage: $0 [jira|confluence]" >&2
  exit 1
fi

EMAIL="${ATLASSIAN_USER_EMAIL:?ATLASSIAN_USER_EMAIL must be set}"

# Resolve token from file or env var. Use eval for name indirection so this runs
# under bash 3.2 (macOS default) and dash, which lack ${VAR^^} uppercase expansion.
UPPER=$(printf '%s' "$PRODUCT" | tr '[:lower:]' '[:upper:]')
TOKEN=$(eval "printf '%s' \"\${ATLASSIAN_${UPPER}_API_TOKEN:-}\"")
TOKEN_FILE=$(eval "printf '%s' \"\${ATLASSIAN_${UPPER}_TOKEN_FILE:-}\"")
if [ -z "$TOKEN" ] && [ -z "$TOKEN_FILE" ]; then
  # Fall back to the skill's default token files in ~/.config
  TOKEN_FILE="$HOME/.config/atlassian-$PRODUCT-token"
fi
if [ -z "$TOKEN" ] && [ -n "$TOKEN_FILE" ]; then
  if [ -f "$TOKEN_FILE" ]; then
    TOKEN="$(cat "$TOKEN_FILE" | tr -d '[:space:]')"
  else
    echo "Token file not found: $TOKEN_FILE" >&2
    exit 1
  fi
fi

if [ -z "$TOKEN" ]; then
  echo "No token found for $PRODUCT (set ATLASSIAN_${UPPER}_API_TOKEN or ATLASSIAN_${UPPER}_TOKEN_FILE)" >&2
  exit 1
fi

# Cloud ID for toyota.atlassian.net
CLOUD_ID="5cc02313-0a4c-4986-8d69-e5ff03892bba"

# /rest/api/3/myself is NOT usable as a probe on this tenant: its OAuth-less API
# allowlist rejects that endpoint with 401 "scope does not match" even for a
# correctly scoped token. Probe a real read endpoint and check its shape instead.
case "$PRODUCT" in
  jira)
    CHECK_URL="https://api.atlassian.com/ex/jira/$CLOUD_ID/rest/api/3/search/jql?jql=issuetype%20%3D%20Bug&maxResults=1"
    PROBE_KEY="issues"
    ;;
  confluence)
    CHECK_URL="https://api.atlassian.com/ex/confluence/$CLOUD_ID/wiki/rest/api/search?cql=type%20%3D%20page&limit=1"
    PROBE_KEY="results"
    ;;
esac

RESPONSE=$(curl -sf --max-time 15 \
  -H "Accept: application/json" \
  -u "$EMAIL:$TOKEN" \
  "$CHECK_URL" 2>&1) || {
  echo "Token invalid for $PRODUCT" >&2
  exit 1
}

# Validate response shape. Prefer node (always present for this skill); fall back to
# python where it is a real interpreter, since Windows ships a `python3` Store stub
# alias that exits non-zero without running anything.
validate() {
  local body="$1" key="$2"
  if command -v node >/dev/null 2>&1; then
    printf '%s' "$body" | KEY="$key" node -e \
      'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.exit(Array.isArray(JSON.parse(d)[process.env.KEY])?0:1)}catch{process.exit(1)}})'
    return $?
  fi
  for py in python python3; do
    if command -v "$py" >/dev/null 2>&1 && "$py" -c '' >/dev/null 2>&1; then
      printf '%s' "$body" | "$py" -c \
        "import sys,json;d=json.load(sys.stdin);sys.exit(0 if isinstance(d.get('$key'),list) else 1)"
      return $?
    fi
  done
  # No interpreter available: settle for a substring check.
  printf '%s' "$body" | grep -q "\"$key\""
}

if ! validate "$RESPONSE" "$PROBE_KEY"; then
  echo "Token invalid for $PRODUCT: response missing '$PROBE_KEY'" >&2
  exit 1
fi

echo "Token valid for $PRODUCT ($EMAIL)"
exit 0
