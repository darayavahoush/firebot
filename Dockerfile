# Build from the repo root:  az acr build -r <acr> -t firebot:tag -f Dockerfile .
FROM node:20-slim AS web
WORKDIR /w
COPY firebot-console/frontend/package*.json ./
RUN npm ci
COPY firebot-console/frontend ./
RUN npm run build

FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 NUMBA_CACHE_DIR=/tmp/numba
WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir ".[pc]"
COPY firebot-console/backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY firebot-console/backend ./backend
COPY firebot-console/deploy/entrypoint.sh ./entrypoint.sh
COPY --from=web /w/dist ./frontend-dist
RUN chmod +x entrypoint.sh
EXPOSE 8000
CMD ["./entrypoint.sh"]
