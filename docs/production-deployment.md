# Production Deployment with Docker

## Prerequisites

- Docker & Docker Compose
- A PostgreSQL-compatible environment (Docker Compose provides it)

## Environment Variables

Create a `.env` file in the project root:

```env
POSTGRES_USER=myapp
POSTGRES_PASSWORD=<strong-random-password>
POSTGRES_DB=myapp_production
JWT_TOKEN_SECRET=<long-random-secret>
```

Optional overrides:

```env
LOG_LEVEL=info
POSTGRES_PORT=5432
```

Do **not** set `PORT` here — it outranks the image's `ENV` and moves the
listener off `folio-backend:3001`, where nginx proxies.

## Deploy

```bash
# 1. Clone and enter the project
git clone <repo-url> myapp
cd myapp

# 2. Set up environment
cp .env.example .env
# Edit .env with production values (see above)

# 3. Run database migrations (first time)
docker compose run --rm api npx prisma migrate deploy

# 4. Build images and start services
docker compose up -d

# 5. Verify the app is running
curl http://localhost:3001/health
# Expected: {"status":"ok","timestamp":"..."}
```

## Managing the Service

```bash
# View logs
docker compose logs -f

# Restart
docker compose restart

# Stop
docker compose down

# Update to new version
git pull
docker compose up -d --build
```

## Health Check

The production image includes a Docker `HEALTHCHECK` that pings `GET /health` every 30s. The container status reflects the app's health.

## Migration Strategy

Migrations are **not** run automatically on container start to prevent race conditions in multi-replica setups.

- **First deploy**: `docker compose run --rm api npx prisma migrate deploy`
- **Updates**: run the same command before rebuilding the api service
- Always test migrations against a staging environment first.

## Architecture

```
                         :3001
    nginx / lb ───► api (node:22-alpine)
                        │
                        │ DATABASE_URL
                        ▼
                    postgres:16-alpine
```
