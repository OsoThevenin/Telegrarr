#!/usr/bin/env bash
# Telegrarr quick-start: generate .env on first run, then build and launch.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "==> First run — creating .env from .env.example"
  cp .env.example .env
  SECRET=$(openssl rand -hex 32)
  PASS=$(openssl rand -base64 15 | tr -d '/+=' | cut -c1-16)
  sed -i "s|^TELEARR_SECRET_KEY=.*|TELEARR_SECRET_KEY=${SECRET}|" .env
  sed -i "s|^TELEARR_ADMIN_PASS=.*|TELEARR_ADMIN_PASS=${PASS}|" .env
  chmod 600 .env
  echo "   generated admin password: ${PASS}  (stored in .env as TELEARR_ADMIN_PASS)"
  echo "   >> Edit .env and set TG_API_ID / TG_API_HASH from https://my.telegram.org before continuing."
fi

DC="docker compose"; docker compose version >/dev/null 2>&1 || DC="docker-compose"
echo "==> Building and starting Telegrarr"
$DC up -d --build

echo "==> Waiting for health"
healthy=""
for _ in $(seq 1 30); do
  if curl -fsS -m3 http://127.0.0.1:8790/healthz >/dev/null 2>&1; then healthy=1; break; fi
  sleep 2
done
$DC ps
if [ -z "$healthy" ]; then
  # A refused PUID/PGID lands here: the container exits before serving anything.
  echo "Telegrarr did not become healthy. Its last log lines:" >&2
  $DC logs --tail 20 telegrarr >&2
  exit 1
fi
echo
echo "Telegrarr is up on port 8790. First-time Telegram login (if no session yet):"
echo "  $DC run --rm telegrarr python authorize.py"
