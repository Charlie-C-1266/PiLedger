# syntax=docker/dockerfile:1.6

# ── PiLedger runtime image ────────────────────────────────────────────────────
# Slim Python 3.12 base. Multi-stage isn't worth the complexity here — the only
# build output is wheels installed into site-packages, which slim already has
# the toolchain to handle. Image size is dominated by Python + FastAPI, not the
# app itself.
FROM python:3.12-slim AS runtime

# Avoid .pyc bloat in the image and unbuffered stdout so `docker logs` shows
# uvicorn output in real time without us reaching for `python -u` everywhere.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install runtime dependencies first as their own layer so editing application
# code doesn't bust the dependency cache on every rebuild.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Application source. The compose file mounts a named volume at /data for the
# SQLite file, and PILEDGER_DB points at that path so user data survives image
# rebuilds and container recreation. The single src-tree COPY also picks up
# security.py (which the previous file-by-file COPY had missed since P0-3
# landed — that bug now can't recur).
COPY src ./src

# Run as an unprivileged user. /data is writable so SQLite can create and
# fsync the DB file inside the mounted volume; /app is read-only at runtime.
RUN useradd --system --uid 10001 --home /home/piledger --create-home piledger \
    && mkdir -p /data \
    && chown -R piledger:piledger /data /app
USER piledger

ENV PILEDGER_DB=/data/piledger.db

EXPOSE 8080

# Health check hits /login because it always returns 200 unauthenticated — /
# returns 302 to /login, which curl/wget treats as success too but /login is
# the most direct "is the SPA wired up" check we can make without a session.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/login', timeout=3).status == 200 else 1)"

CMD ["uvicorn", "--app-dir", "src", "app:app", "--host", "0.0.0.0", "--port", "8080"]
