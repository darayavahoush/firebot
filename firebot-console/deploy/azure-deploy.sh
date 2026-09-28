#!/usr/bin/env bash
# Low-cost Azure deploy for one person: Container App that scales to ZERO when idle, a small
# Postgres you stop when you're done, and (optionally) GitHub's registry instead of a paid ACR.
# Run from the REPO ROOT after `az login`. Safe to re-run: names are saved in .azure-firebot.env.
#
#   Cheapest: export GHCR_USER=<github username> GHCR_PAT=<classic PAT with read:packages>
#             (push to main first so .github/workflows/image.yml has built the image)
#   Otherwise: leave those unset and an Azure Container Registry (~Rs 480/month) is created.
set -euo pipefail
ENVF=.azure-firebot.env
if [ -f "$ENVF" ]; then source "$ENVF"; else
  SUFFIX=$RANDOM
  cat > "$ENVF" <<VARS
SUFFIX=$SUFFIX
RG=firebot-rg
LOC=centralindia
PG=firebot-pg-$SUFFIX
ACR=firebotacr$SUFFIX
CAENV=firebot-env
APP=firebot-app
PGPASS=$(openssl rand -hex 16)
TOKEN=$(openssl rand -hex 16)
VARS
  source "$ENVF"
fi
CPU="${CPU:-0.5}"; MEM="${MEM:-1.0Gi}"   # raise to CPU=1.0 MEM=2.0Gi if the live view lags
GH_REPO="${GH_REPO:-darayavahoush/firebot}"

az extension add --name containerapp --upgrade -y >/dev/null
az provider register -n Microsoft.App --wait
az provider register -n Microsoft.OperationalInsights --wait
az group create -n "$RG" -l "$LOC" -o none

if ! az postgres flexible-server show -g "$RG" -n "$PG" >/dev/null 2>&1; then
  az postgres flexible-server create -g "$RG" -n "$PG" -l "$LOC" \
    --admin-user firebot --admin-password "$PGPASS" \
    --sku-name Standard_B1ms --tier Burstable --storage-size 32 --version 16 \
    --public-access 0.0.0.0 --yes -o none
  az postgres flexible-server db create -g "$RG" -s "$PG" -d firebot -o none
fi
az postgres flexible-server start -g "$RG" -n "$PG" -o none 2>/dev/null || true
DB_URL="postgresql://firebot:${PGPASS}@${PG}.postgres.database.azure.com:5432/firebot?sslmode=require"

if [ -n "${GHCR_PAT:-}" ]; then
  REG_SERVER=ghcr.io; REG_USER="${GHCR_USER:?set GHCR_USER}"; REG_PASS="$GHCR_PAT"
  IMAGE="ghcr.io/$GH_REPO:$(git rev-parse HEAD)"
  echo "Using $IMAGE (built by GitHub Actions; check the Actions tab if the pull fails)"
else
  az acr show -n "$ACR" >/dev/null 2>&1 || az acr create -g "$RG" -n "$ACR" --sku Basic --admin-enabled true -o none
  TAG=$(date +%Y%m%d%H%M%S)
  az acr build -r "$ACR" -t "firebot:$TAG" -f Dockerfile .
  REG_SERVER="$ACR.azurecr.io"
  REG_USER=$(az acr credential show -n "$ACR" --query username -o tsv)
  REG_PASS=$(az acr credential show -n "$ACR" --query "passwords[0].value" -o tsv)
  IMAGE="$ACR.azurecr.io/firebot:$TAG"
fi

az containerapp env show -g "$RG" -n "$CAENV" >/dev/null 2>&1 || az containerapp env create -g "$RG" -n "$CAENV" -l "$LOC" -o none

if az containerapp show -g "$RG" -n "$APP" >/dev/null 2>&1; then
  az containerapp registry set -g "$RG" -n "$APP" --server "$REG_SERVER" --username "$REG_USER" --password "$REG_PASS" -o none
  az containerapp update -g "$RG" -n "$APP" --image "$IMAGE" --min-replicas 0 --max-replicas 1 --cpu "$CPU" --memory "$MEM" -o none
else
  # min 0 = the app costs nothing while nobody has the page open; max 1 because the sim holds state
  az containerapp create -g "$RG" -n "$APP" --environment "$CAENV" --image "$IMAGE" \
    --registry-server "$REG_SERVER" --registry-username "$REG_USER" --registry-password "$REG_PASS" \
    --target-port 8000 --ingress external --min-replicas 0 --max-replicas 1 --cpu "$CPU" --memory "$MEM" \
    --secrets token="$TOKEN" db="$DB_URL" \
    --env-vars FIREBOT_TOKEN=secretref:token FIREBOT_DB=secretref:db \
               FIREBOT_SPEAKER_ID=0 FIREBOT_WEB_DIR=/app/frontend-dist -o none
  az containerapp ingress access-restriction set -g "$RG" -n "$APP" --rule-name me \
    --ip-address "$(curl -s https://ifconfig.me)/32" --action Allow -o none
fi

echo; echo "Live at: https://$(az containerapp show -g "$RG" -n "$APP" --query properties.configuration.ingress.fqdn -o tsv)"
echo "When you're done for the day, run: ./firebot-console/deploy/nirvana-down.sh   (stops the database billing)"
