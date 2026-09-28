#!/usr/bin/env bash
# Stop the database so you only pay for its storage. The app scales to zero by itself.
set -euo pipefail
source "$(git rev-parse --show-toplevel)/.azure-firebot.env"
az postgres flexible-server stop -g "$RG" -n "$PG" -o none
echo "Database stopped. (Azure may restart a stopped server by itself after about a week; run this again if so.)"
