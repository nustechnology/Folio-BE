# Folio-BE

Backend for Folio, a grounded-QA notebook: sources (files, URLs, notes) are
added to a space, parsed, chunked and embedded, then questions are answered
from those sources with citations back into them.

Express + TypeScript, Prisma 7 on PostgreSQL with pgvector, a BullMQ ingestion
worker, MinIO for object storage, and an OpenAI-compatible model gateway for
embeddings and answer generation.

Everything runs in Docker. Ollama is the one exception — it stays on the host,
because Docker Desktop gives containers no Metal access and a containerised
Ollama is dramatically slower.

> **Credentials.** Nothing secret is committed. The chat-model key and the
> Gemini OCR key are handed out individually — **contact SamHT**.

---

## Prerequisites

The reference development environment is macOS on Apple Silicon:

| Tool | Version | Install |
| --- | --- | --- |
| Docker Desktop | 29.x, Compose v5 | [docker.com](https://www.docker.com/products/docker-desktop/) |
| Ollama | 0.32.x | `brew install ollama` |
| Node.js | 22.17.1 (`.nvmrc`) | `nvm install 22.17.1` |
| Yarn | 4.12.0 (Berry) | `corepack enable && corepack prepare yarn@4.12.0 --activate` |

Node and Yarn are needed only so your editor can resolve types — the app itself
always runs in a container.

---

## One-time setup

### 1. Install the embedding model

```bash
brew install ollama
brew services start ollama
ollama pull bge-m3
ollama list                    # bge-m3 must appear
```

`bge-m3` is not interchangeable. `Passage.embedding` is `vector(1024)` (set by
migration `20260811120000_embedding_model_bge_m3`) and the API **refuses to
start** if `MODEL_EMBEDDING_DIMENSIONS` disagrees with that column. Swapping the
embedding model means a migration altering the column *and* a full re-index —
vectors from different models are not comparable.

Answer generation is separate: it goes to a hosted OpenAI-compatible endpoint,
configured below.

### 2. Configure the environment

```bash
cp .env.example .env
```

Fill in the `REQUIRED` block at the top of the file — everything below it has a
working default:

```bash
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=folio-db

# openssl rand -hex 64
JWT_TOKEN_SECRET=
REFRESH_TOKEN_SECRET=

# Both base URLs must be set to the same hosted value — see the warning below.
MODEL_CHAT_BASE_URL=https://llm.nustechnology.com/v1
MODEL_CHAT_BASE_URL_DOCKER=https://llm.nustechnology.com/v1
MODEL_CHAT_API_KEY=<ask SamHT>
MODEL_CHAT_MODEL=mimo-v2.5

GEMINI_API_KEY=<ask SamHT>
SEED_USER_PASSWORD=password123
```

> **`MODEL_CHAT_BASE_URL_DOCKER` is not optional.** Compose's `environment:`
> block overrides `MODEL_CHAT_BASE_URL` with the `_DOCKER` variant, which falls
> back to host Ollama. Set only the plain one and containers send chat
> completions to Ollama, which does not serve `mimo-v2.5` — Ask then fails with
> a connection or 404 error that names neither the setting nor the model.

Two more rules for this file: never commit it, and never put a `#` comment on
the same line as a value. Compose reads `.env` too, and for an empty key it
takes the trailing comment as the value.

### 3. Install dependencies for your editor

```bash
nvm use
yarn install
```

The container installs its own dependencies; this is only so the TypeScript
server in your editor can resolve imports.

### 4. Build and start

```bash
docker compose up -d --build
docker compose ps          # api, worker, db, redis, minio — all healthy
```

### 5. Apply migrations and seed

Migrations are not applied on boot.

```bash
docker compose exec api yarn db:migrate
docker compose exec api yarn db:seed:all      # optional demo data
```

### 6. Verify

```bash
curl localhost:4000/health
open http://localhost:4000/api-docs
```

Then add a source through the API and confirm it moves from `added` to `ready`
in the worker log — that exercises parse, chunk, embed and index end to end:

```bash
docker compose logs -f worker
```

---

## Daily use

```bash
docker compose up -d          # start everything
docker compose logs -f api worker
docker compose ps
docker compose restart api
docker compose down           # stop, keep data
```

`src/` is bind-mounted, so edits on the host restart `tsx watch` inside the
container. Changing `package.json` needs a rebuild:

```bash
docker compose up -d --build
```

To wipe the database, MinIO objects and the Redis queue:

```bash
docker compose down -v
docker compose up -d
docker compose exec api yarn db:migrate
```

### What is running

| Service | Address | Purpose |
| --- | --- | --- |
| `api` | `localhost:4000` | HTTP API, Swagger UI at `/api-docs` |
| `worker` | — | Consumes the BullMQ `ingestion` queue |
| `db` | `localhost:5433` | `pgvector/pgvector:pg16` |
| `redis` | `localhost:6379` | Queue backend |
| `minio` | `localhost:9000`, console `:9001` | Uploaded files and extracted media |

Host ports come from `POSTGRES_PORT`, `REDIS_PORT`, `MINIO_API_PORT` and
`MINIO_CONSOLE_PORT`; change them in `.env` if something already holds one.

---

## Commands

All commands run inside the `api` container:

```bash
docker compose exec api yarn <command>
```

| Command | Purpose |
| --- | --- |
| `yarn db:migrate` | `prisma migrate dev` — create/apply dev migrations |
| `yarn db:migrate-prod` | `prisma migrate deploy` — committed migrations only |
| `yarn db:generate` | Regenerate Prisma Client into `src/generated/prisma` |
| `yarn db:reset` | Drop and re-apply everything, no seed |
| `yarn db:seed` / `yarn db:seed:all` | Seed spaces / spaces + ask data |
| `yarn reingest` | Re-index every source against the current embedding model (`--help` for filters, `--reextract`, `--dry-run`) |
| `yarn test` | Vitest, single run |
| `yarn typecheck` | `tsc --noEmit`, tests included |
| `yarn lint` | ESLint on `src/**/*.ts`, autofix |
| `yarn build` | Compile to `dist/` |

There is no CI — run lint, typecheck and tests before pushing:

```bash
docker compose exec api sh -c "yarn lint && yarn typecheck && yarn test"
```

---

## Environment variables

`.env.example` is the reference: a short `REQUIRED` block, then every optional
key with its default noted above it. Defaults live in
`src/config/enviroment.ts`.

A few worth knowing:

| Variable | Note |
| --- | --- |
| `ENABLE_API_DOCS` | Serves Swagger UI only when exactly `true`. Unset in production |
| `CORS_ORIGIN` | Blank in development means `http://localhost:3000` plus any HTTPS ngrok/Cloudflare tunnel origin. Required in production |
| `MODEL_EMBEDDING_RPM` | Texts per minute, not HTTP calls. `0` disables the throttle, which is what the local model wants |
| `DATABASE_URL` | Overridden inside Compose to the `db` hostname; only read by the Prisma CLI outside it |
| `MINIO_*`, `REDIS_*` | Compose points these at its own services; the defaults already agree |

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Missing required environment variable(s)` | `JWT_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET` unset |
| Startup error naming `MODEL_EMBEDDING_DIMENSIONS` | It disagrees with the `vector(1024)` column — keep it 1024 for `bge-m3` |
| `db` container will not start | `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` are blank; Compose has no defaults for them |
| Ask fails, ingestion is fine | `MODEL_CHAT_BASE_URL_DOCKER` unset, so chat went to Ollama |
| Ingestion fails at the embedding step | Ollama is not running on the host, or `bge-m3` was never pulled |
| Sources stay in `added` | The `worker` container is down — `docker compose ps` |
| A config value looks like `# default: ...` | An inline comment in `.env` on an otherwise empty key |
| `port is already allocated` | Change `POSTGRES_PORT`, `REDIS_PORT` or `MINIO_API_PORT` in `.env` |
| `/api-docs` returns 404 | `ENABLE_API_DOCS` is not exactly `true` |

---

## Architecture

```text
HTTP request
    |
    v
Express router          validate with Joi, authenticate, rate-limit
    |
    v
Controller              translate HTTP input/output
    |
    v
Service                 application logic
    |
    v
Repository              Prisma queries, strip sensitive fields
    |
    v
PostgreSQL + pgvector
```

Ingestion runs out of band:

```text
POST /sources ──▶ MinIO (original file)
            └──▶ BullMQ `ingestion` (Redis)
                        |
                        v
                  worker container
              extract → normalize → chunk → embed → index
                        |
                        v
              Passage rows: embedding vector(1024) + searchVector tsvector
```

Asking a question resolves scope → `retrieval.service.ts` (hybrid search: HNSW
cosine fused with tsvector by Reciprocal Rank Fusion, plus citation locators) →
`ask-prompt.service.ts` (prompt and answer post-processing) →
`model-gateway.service.ts` (streamed completion). The controller owns the SSE
transport, so `POST /spaces/:spaceId/ask` streams rather than returning one
JSON body.

### Directory structure

```text
.
├── prisma.config.ts              # Prisma 7 CLI config (defineConfig)
├── src
│   ├── index.ts                  # entry point: ensureBucket(), HTTP listener
│   ├── api
│   │   ├── index.ts              # Express app, global middleware, Swagger mount
│   │   ├── docs                  # OpenAPI specification
│   │   ├── routes                # route definitions + Joi validators
│   │   ├── controllers           # HTTP input/output orchestration
│   │   ├── services              # business logic, ingestion pipeline, ask/retrieval
│   │   ├── errors                # application errors carrying HTTP status codes
│   │   ├── middlewares           # auth, validation, rate limit, upload, logging, errors
│   │   └── utils                 # MinIO, files, HTML/text, tokens, embeddings
│   ├── config                    # enviroment.ts (sic), logger, cors, redis, minio, request-context
│   ├── queues                    # ingestion.queue.ts
│   ├── workers                   # ingestion.worker.ts — the worker container's entry point
│   ├── scripts                   # reingest-sources.ts
│   ├── prisma
│   │   ├── schema.prisma
│   │   ├── migrations            # committed; production runs migrate deploy
│   │   ├── repositories          # database access
│   │   └── seeds
│   └── generated/prisma          # build artifact — never edit
├── Dockerfile                    # local development image
├── Dockerfile.prod               # production image
└── docker-compose.yml
```

---

## API

Base URL `http://localhost:4000/api/v1`. See `/api-docs` for the full surface
with schemas and interactive examples — log in, select **Authorize** and paste
the access token; Swagger adds the `Bearer` prefix itself.

| Path | Purpose |
| --- | --- |
| `/auth` | `sign-up`, `login`, `refresh`, `logout` |
| `/users` | Get a user by numeric ID or `me`; update the authenticated profile |
| `/spaces` | Spaces, and nested under `/:spaceId`: notes, `ask`, conversations |
| `/sources` | Upload/create, list, status, retry, delete, serve extracted media |
| `/passages` | Passage lookup behind citations |
| `/health` | Service health and timestamp (unauthenticated) |

Login returns a short-lived access token (`ACCESS_TOKEN_EXPIRATION`, 15m by
default) and a refresh token (`REFRESH_TOKEN_EXPIRATION`, 30d). Send the access
token as `Authorization: Bearer <token>`; exchange the refresh token at
`POST /auth/refresh`.

Responses use `{ "status": "success", "data": {} }` or
`{ "status": "error", "message": "..." }`.

---

## Coding pattern

Adding a feature, in order:

1. Update `src/prisma/schema.prisma`.
2. `docker compose exec api yarn prisma migrate dev --name describe_change`,
   then `docker compose exec api yarn db:generate`.
3. Database queries → a repository in `src/prisma/repositories`.
4. Application logic → a service in `src/api/services`.
5. HTTP orchestration → a controller in `src/api/controllers`.
6. Validation and middleware composition → a router.
7. Mount it in `src/api/routes/index.ts`.

Conventions:

- **CommonJS** — no `"type": "module"`; `tsc` emits `require()`/`exports`.
- **Path alias `~/*` → `src/*`.** All source imports use it; no relative
  imports outside generated code. `tsc-alias` rewrites them in `dist/`.
- Routers stay thin and HTTP-focused; services hold no raw database queries;
  repositories decide no status codes and send no responses.
- Validate untrusted input before the controller. Authenticated routes sit
  behind `auth`.
- Never return password hashes or put them in JWT payloads.
- Tests are colocated as `src/**/*.test.ts` so lint and typecheck cover them;
  `tsconfig.build.json` keeps them out of `dist/`.
- Prettier: 80 columns, single quotes, no trailing commas.
- Treat `src/generated/prisma` as a build artifact — change the schema and
  regenerate.
- Commit migration directories; never run `migrate dev` against production.

---

## Logging

Winston, structured, with request context carried across async handlers by
`AsyncLocalStorage`.

- Development logs are colorized and human-readable; production logs are JSON.
- Every request gets an `x-request-id` response header. An incoming one is
  reused when it is ≤128 characters, otherwise a UUID is generated.
- Completed-request logs include method, path, status, duration, request ID and
  the authenticated user ID when known.
- Error middleware logs the full stack once: expected `4xx` at `warn`,
  unexpected `5xx` at `error`. Production responses expose no stack traces.

Set the floor with `LOG_LEVEL` (`error`, `warn`, `info`, `http`, `debug`).

Never log passwords, tokens, authorization headers, secrets, full database
URLs, or sensitive request bodies.

---

## Deployment

Production is built from `Dockerfile.prod` — the plain `Dockerfile` is the
development image used above. Provide `DATABASE_URL`, both token secrets,
`CORS_ORIGIN`, `NODE_ENV=production` and `LOG_LEVEL=info` through the
platform's secret store, leave `ENABLE_API_DOCS` unset, run
`yarn db:migrate-prod` from a release job before starting the new version,
terminate HTTPS at the edge, and point health checks at `/health`.

Deployment secrets: **contact SamHT.**
