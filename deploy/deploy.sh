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

# Postgres sets its password only when the data volume is first created, so a
# changed .env would lock the API out. Keep the database password in sync.
DB_PASSWORD="$(grep -m1 '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)"
echo "ALTER USER classes PASSWORD :'pw';" |
  docker compose exec -T db psql -q -U classes -d classes -v pw="$DB_PASSWORD" >/dev/null
docker compose restart api

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
# The site file is rewritten on every run, so certbot never edits it: certbot
# only fetches the certificate (webroot mode) and this script wires it in.
ACME_ROOT=/var/www/letsencrypt
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
sudo mkdir -p /etc/nginx/snippets "$ACME_ROOT"
sudo cp deploy/nginx.conf /etc/nginx/snippets/members-app.conf
sudo sed -i "s#root /var/www/members;#root $WEB_ROOT;#" /etc/nginx/snippets/members-app.conf

write_site() {
  local acme="location /.well-known/acme-challenge/ { root $ACME_ROOT; }"
  if sudo test -f "$CERT_DIR/fullchain.pem"; then
    cat <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    $acme
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN;
    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;
    include /etc/nginx/snippets/members-app.conf;
}
EOF
  else
    cat <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    $acme
    include /etc/nginx/snippets/members-app.conf;
}
EOF
  fi
}

# Debian/Ubuntu use sites-available + sites-enabled; other distros use conf.d.
if [[ ! -d /etc/nginx/sites-enabled ]]; then NGINX_SITE=/etc/nginx/conf.d/members.conf; fi
write_site | sudo tee "$NGINX_SITE" >/dev/null
[[ -d /etc/nginx/sites-enabled ]] && sudo ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/members
# The stock "Welcome to nginx" site (and anything certbot added to it) would
# otherwise answer for this domain.
sudo rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf
sudo nginx -t
sudo systemctl reload nginx

if ! sudo test -f "$CERT_DIR/fullchain.pem"; then
  echo "==> TLS certificate"
  email_args=(--register-unsafely-without-email)
  [[ -n "${CERT_EMAIL:-}" ]] && email_args=(-m "$CERT_EMAIL")
  sudo certbot certonly --webroot -w "$ACME_ROOT" -d "$DOMAIN" \
    --non-interactive --agree-tos "${email_args[@]}"
  write_site | sudo tee "$NGINX_SITE" >/dev/null
  sudo nginx -t
  sudo systemctl reload nginx
fi

echo "Done. https://$DOMAIN"
