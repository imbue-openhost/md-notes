#!/bin/sh
set -e

# Emit runtime-config.js so the static frontend can learn deploy-time env vars
# without rebuilding the bundle. Regenerated each container start so the values
# always match the current environment.
CONFIG_FILE=/app/frontend/dist/runtime-config.js
if [ -n "$OPENHOST_ZONE_DOMAIN" ]; then
  LOGIN_URL_JSON="\"https://${OPENHOST_ZONE_DOMAIN}/login\""
else
  LOGIN_URL_JSON="null"
fi

cat > "$CONFIG_FILE" <<EOF
window.__CONFIG__ = { loginUrl: ${LOGIN_URL_JSON} };
EOF

caddy run --config /etc/caddy/Caddyfile &
exec .venv/bin/python -u -m server
