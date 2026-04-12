FROM node:22-alpine AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ─────────────────────────────────────────────────────────────

FROM python:3.13-alpine

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN uv pip install --system -r requirements.txt

# Copy server code
COPY server/ server/

# Copy built frontend
COPY --from=frontend-build /build/frontend/dist frontend/dist

EXPOSE 8080

CMD ["python", "-u", "-m", "server"]
