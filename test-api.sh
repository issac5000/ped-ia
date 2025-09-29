#!/bin/zsh

BASE_URL="https://synapkids.com/api"

echo "---- Test /api/ai (blague simple) ----"
curl -s -X POST "$BASE_URL/ai" \
  -H "Content-Type: application/json" \
  --data '{
    "prompt": "Dis-moi une petite blague sur les enfants"
  }' | jq

echo "\n---- Test /api/ai (child-full-report) ----"
curl -s -X POST "$BASE_URL/ai" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "child-full-report",
    "childId": "880fce36-fa8e-4851-aa16-b6f1a537cd4f",
    "anonCode": "X9R8N7B8R2K2"
  }' | jq

echo "\n---- Test /api/image ----"
curl -s -X POST "$BASE_URL/image" \
  -H "Content-Type: application/json" \
  --data '{
    "prompt": "Un bébé qui rit avec un doudou",
    "size": "512x512"
  }' | jq
