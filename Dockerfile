# syntax=docker/dockerfile:1.6

# ── Stage 1: Build the React frontend ────────────────────────────────────────
FROM node:20-slim AS frontend-build

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: PiLedger runtime image ─────────────────────────────────────────
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY src ./src
COPY docs ./docs

# Copy the built React frontend into the static directory.
# Vite's outDir is "../src/static/dist" relative to /build, i.e. /src/static/dist.
COPY --from=frontend-build /src/static/dist ./src/static/dist

RUN useradd --system --uid 10001 --home /home/piledger --create-home piledger \
    && mkdir -p /data \
    && chown -R piledger:piledger /data /app
USER piledger

ENV PILEDGER_DB=/data/piledger.db

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import json,urllib.request,sys; r=urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3); sys.exit(0 if r.status==200 and json.load(r).get('ok') is True else 1)"

CMD ["uvicorn", "--app-dir", "src", "app:app", "--host", "0.0.0.0", "--port", "8080"]
