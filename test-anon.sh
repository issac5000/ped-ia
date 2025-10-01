#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
LIKE_REPLY_ID="${LIKE_REPLY_ID:-}"
LIKE_TOPIC_ID="${LIKE_TOPIC_ID:-}"

if [[ -z "$LIKE_REPLY_ID" && -z "$LIKE_TOPIC_ID" ]]; then
  echo "Set LIKE_REPLY_ID or LIKE_TOPIC_ID to run likes-add check" >&2
  exit 1
fi

like_topic_id="${LIKE_TOPIC_ID:-$LIKE_REPLY_ID}"
like_reply_id="$LIKE_REPLY_ID"

request_json() {
  local endpoint="$1"
  local body="$2"
  local tmp
  tmp=$(mktemp)
  local status
  status=$(curl -sS -o "$tmp" -w '%{http_code}' -X POST "${BASE_URL}${endpoint}" \
    -H 'Content-Type: application/json' \
    -d "$body")
  if [[ "$status" != "200" ]]; then
    echo "Request to ${endpoint} failed with status ${status}" >&2
    cat "$tmp" >&2 || true
    rm -f "$tmp"
    exit 1
  fi
  cat "$tmp"
  rm -f "$tmp"
}

create_payload='{}'
create_response=$(request_json '/api/edge/profiles-create-anon' "$create_payload")
code=$(python - <<'PY' <<<"$create_response"
import json, sys
try:
    data = json.load(sys.stdin)
except json.JSONDecodeError as exc:
    raise SystemExit(f"Invalid JSON response: {exc}")
profile = (data or {}).get('data', {}).get('profile') or {}
code = profile.get('code_unique')
if not code:
    raise SystemExit('Missing code_unique in response')
sys.stdout.write(str(code))
PY
)
echo "Received anon code: ${code}"

parent_payload=$(cat <<JSON
{ "action": "profile", "code": "${code}" }
JSON
)
request_json '/api/edge/anon-parent-updates' "$parent_payload" >/dev/null

echo "anon-parent-updates succeeded"

likes_payload=$(cat <<JSON
{
  "code": "${code}",
  "topic_id": "${like_topic_id}"$(
    if [[ -n "$like_reply_id" ]]; then
      printf ',\n  "replyId": "%s"' "$like_reply_id"
    fi
  )
}
JSON
)
request_json '/api/edge/likes-add' "$likes_payload" >/dev/null

echo "likes-add succeeded"

echo "All anonymous edge checks passed."
