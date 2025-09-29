#!/bin/zsh

SUPABASE_URL="https://myrwcjurblksypvekuzb.supabase.co/functions/v1"
ANONCODE="X9R8N7B8R2K2"

echo "---- Test likes-get ----"
curl -s -X POST "$SUPABASE_URL/likes-get" \
  -H "Content-Type: application/json" \
  --data '{"replyIds":["3bca815e-1383-4340-8047-61c7a2b604d5"], "anonCode":"'"$ANONCODE"'"}'

echo "\n---- Test likes-add ----"
curl -s -X POST "$SUPABASE_URL/likes-add" \
  -H "Content-Type: application/json" \
  --data '{"replyId":"3bca815e-1383-4340-8047-61c7a2b604d5", "anonCode":"'"$ANONCODE"'"}'

echo "\n---- Test likes-remove ----"
curl -s -X POST "$SUPABASE_URL/likes-remove" \
  -H "Content-Type: application/json" \
  --data '{"replyId":"3bca815e-1383-4340-8047-61c7a2b604d5", "anonCode":"'"$ANONCODE"'"}'

echo "\n---- Test child-updates ----"
curl -s -X POST "$SUPABASE_URL/child-updates" \
  -H "Content-Type: application/json" \
  --data '{"childId":"ad0e73cc-9e4f-41f5-a85f-21e3bde3855c", "anonCode":"'"$ANONCODE"'", 
"updateContent":"Petit test via script"}'

echo "\n---- Test messages-delete-conversation ----"
curl -s -X POST "$SUPABASE_URL/messages-delete-conversation" \
  -H "Content-Type: application/json" \
  --data '{"otherId":"05a23434-1127-485e-88a2-a89bc0da0459", "anonCode":"'"$ANONCODE"'"}'

echo "\n---- Test profiles-by-ids ----"
curl -s -X POST "$SUPABASE_URL/profiles-by-ids" \
  -H "Content-Type: application/json" \
  --data '{"ids":["05a23434-1127-485e-88a2-a89bc0da0459"], "anonCode":"'"$ANONCODE"'"}'

