FROM node:22-alpine AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ─────────────────────────────────────────────────────────────

FROM python:3.12-alpine

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
RUN apk add --no-cache caddy

WORKDIR /app

# Install Python dependencies
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Copy server code
COPY server/src/server/ server/

# Copy built frontend
COPY --from=frontend-build /build/frontend/dist frontend/dist

# Caddy config
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 8080

CMD sh -c "caddy run --config /etc/caddy/Caddyfile & uv run python -u -m server"
