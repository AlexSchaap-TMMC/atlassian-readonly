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

# Resolve token from file or env var
TOKEN="${ATLASSIAN_${PRODUCT^^}_API_TOKEN:-}"
TOKEN_FILE="${ATLASSIAN_${PRODUCT^^}_TOKEN_FILE:-}"
if [ -z "$TOKEN" ] && [ -n "$TOKEN_FILE" ]; then
  if [ -f "$TOKEN_FILE" ]; then
    TOKEN="$(cat "$TOKEN_FILE" | tr -d '[:space:]')"
  else
    echo "Token file not found: $TOKEN_FILE" >&2
    exit 1
  fi
fi

if [ -z "$TOKEN" ]; then
  echo "No token found for $PRODUCT (set ATLASSIAN_${PRODUCT^^}_API_TOKEN or ATLASSIAN_${PRODUCT^^}_TOKEN_FILE)" >&2
  exit 1
fi

# Cloud ID for toyota.atlassian.net
CLOUD_ID="5cc02313-0a4c-4986-8d69-e5ff03892bba"
BASE_URL="https://api.atlassian.com/ex/$PRODUCT/$CLOUD_ID/rest/api/3/myself"

RESPONSE=$(curl -sf --max-time 10 \
  -H "Accept: application/json" \
  -u "$EMAIL:$TOKEN" \
  "$BASE_URL" 2>&1) || {
  echo "Token invalid for $PRODUCT" >&2
  exit 1
}

ACCOUNT=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('emailAddress','?'))" 2>/dev/null || echo "unknown")
echo "Token valid for $PRODUCT ($ACCOUNT)"
exit 0
