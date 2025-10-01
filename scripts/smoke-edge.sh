#!/usr/bin/env bash
set -euo pipefail
BASE="${BASE:-https://synapkids.com}"

echo "== Create anon =="
curl -s -i "$BASE/api/edge/profiles-create-anon" \
  -H "Content-Type: application/json" \
  -d '{"action":"create"}' | sed -n '1,10p'

echo
echo "== Login by code (replace CODE) =="
CODE="${CODE:-A1B2-C3D4-E5F6}"
curl -s -i "$BASE/api/edge/anon-parent-updates" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"profile\",\"code\":\"$CODE\"}" | sed -n '1,12p'

echo
echo "== Likes get (replace reply id & CODE) =="
RID="${RID:-00000000-0000-0000-0000-000000000000}"
curl -s -i "$BASE/api/edge/likes-get" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"list-by-reply-ids\",\"ids\":[\"$RID\"],\"code\":\"$CODE\"}" | sed -n '1,12p'
