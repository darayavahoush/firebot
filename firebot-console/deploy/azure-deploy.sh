#!/usr/bin/env bash
# Deploy NIRVANA to Azure: Postgres Flexible Server + Container Registry + one Container App
# (API, simulated robot, brain, and the built frontend, all behind one HTTPS URL).
# Run from the REPO ROOT after `az login`. Safe to re-run: it reuses names saved in .azure-firebot.env.
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

az extension add --name containerapp --upgrade -y >/dev/null
az provider register -n Microsoft.App --wait
az provider register -n Microsoft.OperationalInsights --wait

az group create -n "$RG" -l "$LOC" -o none

if ! az postgres flexible-server show -g "$RG" -n "$PG" >/dev/null 2>&1; then
  az postgres flexible-server create -g "$RG" -n "$PG" -l "$LOC" \
    --admin-user firebot --admin-password "$PGPASS" \
    --sku-name Standard_B1ms --tier Burstable --storage-size 32 --version 16 \
    --public-access 0.0.0.0 --yes -o none   # 0.0.0.0 = allow Azure services only
  az postgres flexible-server db create -g "$RG" -s "$PG" -d firebot -o none
fi
DB_URL="postgresql://firebot:${PGPASS}@${PG}.postgres.database.azure.com:5432/firebot?sslmode=require"

az acr show -n "$ACR" >/dev/null 2>&1 || az acr create -g "$RG" -n "$ACR" --sku Basic --admin-enabled true -o none
TAG=$(date +%Y%m%d%H%M%S)
az acr build -r "$ACR" -t "firebot:$TAG" -f Dockerfile .

az containerapp env show -g "$RG" -n "$CAENV" >/dev/null 2>&1 || az containerapp env create -g "$RG" -n "$CAENV" -l "$LOC" -o none
ACR_USER=$(az acr credential show -n "$ACR" --query username -o tsv)
ACR_PASS=$(az acr credential show -n "$ACR" --query "passwords[0].value" -o tsv)
IMAGE="$ACR.azurecr.io/firebot:$TAG"

if az containerapp show -g "$RG" -n "$APP" >/dev/null 2>&1; then
  az containerapp update -g "$RG" -n "$APP" --image "$IMAGE" -o none
else
  # min=max=1 on purpose: the simulated robot and brain hold live state in memory
  az containerapp create -g "$RG" -n "$APP" --environment "$CAENV" --image "$IMAGE" \
    --registry-server "$ACR.azurecr.io" --registry-username "$ACR_USER" --registry-password "$ACR_PASS" \
    --target-port 8000 --ingress external --min-replicas 1 --max-replicas 1 --cpu 1.0 --memory 2.0Gi \
    --secrets token="$TOKEN" db="$DB_URL" \
    --env-vars FIREBOT_TOKEN=secretref:token FIREBOT_DB=secretref:db \
               FIREBOT_SPEAKER_ID=0 FIREBOT_WEB_DIR=/app/frontend-dist -o none
  # The console has no login and can drive the robot, so only your current IP may reach it.
  az containerapp ingress access-restriction set -g "$RG" -n "$APP" --rule-name me \
    --ip-address "$(curl -s https://ifconfig.me)/32" --action Allow -o none
fi

echo; echo "Live at: https://$(az containerapp show -g "$RG" -n "$APP" --query properties.configuration.ingress.fqdn -o tsv)"
echo "Logs:    az containerapp logs show -g $RG -n $APP --follow"
