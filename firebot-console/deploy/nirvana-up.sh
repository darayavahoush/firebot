#!/usr/bin/env bash
# Start the database, then open the site (the app itself wakes on the first request).
set -euo pipefail
source "$(git rev-parse --show-toplevel)/.azure-firebot.env"
az postgres flexible-server start -g "$RG" -n "$PG" -o none 2>/dev/null || true
URL="https://$(az containerapp show -g "$RG" -n "$APP" --query properties.configuration.ingress.fqdn -o tsv)"
echo "Database up. Opening $URL (first load takes a little while)"
open "$URL" 2>/dev/null || echo "$URL"
