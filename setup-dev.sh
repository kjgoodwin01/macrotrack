#!/usr/bin/env bash
# Run this once after `npx wrangler login` to fill in your KV namespace IDs.
set -e

echo "Looking up KV namespaces..."
KV_JSON=$(npx wrangler kv namespace list 2>/dev/null)

# Find the namespace named CODES (or macrotrack-related)
KV_ID=$(echo "$KV_JSON" | grep -A2 '"CODES"' | grep '"id"' | head -1 | sed 's/.*"id": *"\([^"]*\)".*/\1/')

if [ -z "$KV_ID" ]; then
  echo ""
  echo "Could not auto-detect KV namespace. Available namespaces:"
  echo "$KV_JSON" | grep -E '"title"|"id"'
  echo ""
  echo "Paste the correct ID for your CODES namespace and press Enter:"
  read -r KV_ID
fi

echo "Using KV namespace ID: $KV_ID"

# Write wrangler.toml with real IDs
cat > wrangler.toml << EOF
name = "macrotrack-ai"
main = "worker.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "CODES"
id = "$KV_ID"
preview_id = "$KV_ID"

[triggers]
crons = ["0 14 * * 0", "0 16 * * *", "0 21 * * *"]
EOF

echo ""
echo "wrangler.toml updated. Now fill in .dev.vars with your secrets, then run:"
echo "  npx wrangler dev"
echo ""
echo "To trigger the scheduled event in a second terminal:"
echo "  curl \"http://localhost:8787/__scheduled?cron=0+16+*+*+*\""
