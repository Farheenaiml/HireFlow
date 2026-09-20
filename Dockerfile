# ---------------------------------------------------------------- build the SPA
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci || npm install
COPY web/ ./
# Same-origin deploy: the API serves the built assets, so /api is a relative path.
ENV VITE_API_BASE=
RUN npm run build

# ---------------------------------------------------------------- runtime
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=8000
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

COPY api/requirements.txt ./api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt

COPY api/ ./api/
COPY --from=web /web/dist ./web/dist

RUN useradd -m hireflow && chown -R hireflow /app
USER hireflow

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD curl -fsS http://127.0.0.1:${PORT}/health || exit 1

WORKDIR /app/api
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
