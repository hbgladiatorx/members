#!/usr/bin/env bash
# Deploy (or update) Mainstay Classes on the server. Run from the repo root:
#
#   ./deploy/deploy.sh
#
# Needs Docker (with Compose), Nginx and sudo. Safe to re-run: it rebuilds the
# API, re-exports the web app and reloads Nginx. Database and photos live in
# Docker volumes and are kept.
set -euo pipefail

DOMAIN="${DOMAIN:-members.cimcha.com}"
WEB_ROOT="${WEB_ROOT:-/var/www/members}"
NGINX_SITE=/etc/nginx/sites-available/members

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Missing .env. Run: cp .env.example .env, then fill in POSTGRES_PASSWORD and JWT_SECRET." >&2
  exit 1
fi

echo "==> API, database and Redis"
docker compose up -d --build

echo "==> Waiting for the API"
for _ in $(seq 1 30); do
  curl -fsS http://127.0.0.1:4000/health >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS http://127.0.0.1:4000/health >/dev/null || { docker compose logs --tail=50 api; exit 1; }

echo "==> Web app (built in a throwaway Node container)"
docker run --rm -v "$PWD/apps/mobile:/app" -w /app \
  -e EXPO_PUBLIC_API_URL="https://$DOMAIN/api" \
  node:22 sh -c "npm ci --no-audit --no-fund && npm run export:web"
sudo mkdir -p "$WEB_ROOT"
sudo rsync -a --delete apps/mobile/dist/ "$WEB_ROOT/"

echo "==> Nginx"
# Debian/Ubuntu use sites-available + sites-enabled; other distros use conf.d.
if [[ ! -d /etc/nginx/sites-enabled ]]; then NGINX_SITE=/etc/nginx/conf.d/members.conf; fi
if [[ ! -f "$NGINX_SITE" ]]; then
  # First run only; afterwards certbot has edited the file, so leave it alone.
  sed "s/members\.cimcha\.com/$DOMAIN/g" deploy/nginx.conf | sudo tee "$NGINX_SITE" >/dev/null
  [[ -d /etc/nginx/sites-enabled ]] && sudo ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/members
fi
# The stock "Welcome to nginx" site would otherwise answer instead of the app.
sudo rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf
sudo nginx -t
sudo systemctl reload nginx

echo "Done. https://$DOMAIN"
if ! sudo test -d "/etc/letsencrypt/live/$DOMAIN"; then
  echo "No TLS certificate yet. Run once: sudo certbot --nginx -d $DOMAIN"
fi
