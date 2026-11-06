# Multi-stage: compile wheels (cryptg/bcrypt need a C toolchain) in the builder,
# ship a slim runtime with no compiler. Starts as root only so the entrypoint can
# apply PUID/PGID, then drops to the unprivileged app user; APP_UID/APP_GID are the
# ids used when PUID/PGID are unset. Compose `user:` skips all of that.

# The web UI builds to static files, so it needs no emulation on multi-arch builds
# and Node stays out of the runtime image. Its dictionaries live in app/static/i18n.
FROM --platform=$BUILDPLATFORM node:24-slim AS frontend
RUN corepack enable
WORKDIR /src/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
COPY app/static/i18n /src/app/static/i18n
RUN pnpm build

FROM python:3.14-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc build-essential && rm -rf /var/lib/apt/lists/*
WORKDIR /wheels
COPY requirements.txt .
RUN pip wheel --wheel-dir /wheels -r requirements.txt

FROM python:3.14-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN apt-get update && apt-get install -y --no-install-recommends curl gosu \
        && rm -rf /var/lib/apt/lists/*
COPY --from=builder /wheels /wheels
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --no-index --find-links /wheels -r /app/requirements.txt \
        && rm -rf /wheels
ARG APP_UID=1000
ARG APP_GID=1000
RUN groupadd --gid "${APP_GID}" telegrarr \
        && useradd --uid "${APP_UID}" --gid "${APP_GID}" --no-create-home \
           --home-dir /data --shell /usr/sbin/nologin telegrarr \
        && mkdir -p /data /media \
        && chown "${APP_UID}:${APP_GID}" /data
WORKDIR /app
COPY app /app/app
COPY --from=frontend /src/frontend/dist /app/frontend/dist
COPY authorize.py /app/authorize.py
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/telegrarr-entrypoint
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8790/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/telegrarr-entrypoint"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8790", "--workers", "1"]
