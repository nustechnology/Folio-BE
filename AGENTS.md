# AGENTS.md — Folio-BE (Express + Prisma + PostgreSQL)

## Quick start

Everything runs in Docker Compose except Ollama, which stays on the host.
Full walkthrough in `README.md#setup`.

```bash
cp .env.example .env       # fill in the REQUIRED block; it sets COMPOSE_FILE=docker-compose.dev.yml
nvm use                    # Node 22.17 — only for the editor's TypeScript server
yarn install               # likewise; the container installs its own dependencies
ollama pull bge-m3         # host Ollama serves local embeddings
docker compose up -d --build              # api, worker, db, redis, minio
docker compose exec api yarn db:migrate   # migrations are never applied on boot
```

## Commands

Run inside the `api` container: `docker compose exec api yarn <command>`.

| Command | Purpose |
|---------|---------|
| `yarn dev` | API under `tsx watch` — the `api` service's default command |
| `yarn dev:worker` | ingestion worker (BullMQ + Redis) — the `worker` service's command |
| `yarn build` | `yarn db:generate && tsc -b tsconfig.build.json --clean && tsc -p tsconfig.build.json && tsc-alias -p tsconfig.build.json` |
| `yarn lint` | ESLint on `src/**/*.ts`, autofix |
| `yarn db:generate` | `prisma generate` (output: `src/generated/prisma`) |
| `yarn db:migrate` | `prisma migrate dev` (interactive, prompts for name) |
| `yarn db:migrate-prod` | `prisma migrate deploy` (apply committed migrations only) |
| `yarn db:seed` | `tsx src/prisma/seeds/space.seed.ts` — six spaces |
| `yarn db:seed:ask` | `tsx src/prisma/seeds/ask.seed.ts` — four ingested sources |
| `yarn reingest` | re-index every source against the current embedding model (`--help` for filters, `--reextract`, `--dry-run`) |
| `yarn reingest:prod` | the same script from `dist/`, for the production image |
| `yarn test` | Vitest, single run (`yarn test:watch` to watch) |
| `yarn typecheck` | `tsc --noEmit`, tests included |

## Architecture

```
router (validate + middleware) → controller → service → repository (Prisma queries)
```

Routers are thin (Joi validation, middleware composition, response). Controllers extract request data and return responses. Services contain business logic. Repositories contain database queries.

- **Entrypoint**: `src/index.ts` — `ensureBucket()`, then the HTTP listener on `PORT` (default `3001`)
- **Express app**: `src/api/index.ts` — mounts `/api/v1`, Swagger UI at `/api-docs`, global error middleware
- **Routes**: `src/api/routes/index.ts` — mounts `users`, `auth`, `spaces`, `sources`, `passages`. `spaces` nests `notes`, `notebook`, `ask` and `conversations` under `/:spaceId`
- **Ask (grounded QA)**: `ask.service.ts` orchestrates one answer — scope resolution → `retrieval.service.ts` (hybrid search + citation locators) → `ask-prompt.service.ts` (prompt + answer post-processing) → `model-gateway.service.ts` (streamed completion). The controller owns the SSE transport via `sse.service.ts#openEventStream`; `ask-suggestion.service.ts` backs the empty-state chips
- **Ingestion worker**: `src/workers/ingestion.worker.ts` — separate process (`yarn dev:worker`); picks `ingestion` BullMQ jobs and runs extract → normalize → chunk → embed → index. Extraction first looks for a `ready` source of the same owner with the same `fileHash` and reuses its stored output, skipping the download, the parse and any OCR; `enqueueIngestion(id, { forceReparse: true })` opts out, which is what `--reextract` uses. Spreadsheet sources skip the first (breakpoint) embedding pass
- **Parsers**: `src/api/services/parse.service.ts` — one parser per format, each returning `content` (text for embeddings) + `structuredContent` (reader HTML or slide/sheet JSON). All reader HTML goes through `finalizeHtml` (sanitize → table headers → styling); text projections of HTML come from `src/api/utils/html-to-text.util.ts`
- **Embedded media**: images inside DOCX/EPUB are written to object storage by `src/api/services/media.service.ts` under `sources/<sourceId>/media/` and served by the public `GET /sources/:sourceId/media/:fileName` route — never inlined as data: URIs
- **Original files**: `GET /sources/:sourceId/preview` (authenticated) mints a 5-minute file token; `GET /sources/:sourceId/file?token=…` (no `auth`) streams the stored original through the API. Tokens are pinned to one source and carry `typ: 'file'` (`src/api/utils/token.util.ts`)
- **Queue**: `src/queues/ingestion.queue.ts` — enqueues `{ sourceId }` jobs after source creation/retry
- **Config**: `src/config/enviroment.ts` (note: misspelled filename), `logger.ts`, `request-context.ts`, `redis.ts`, `minio.ts`, `cors.ts`
- **Prisma schema**: `src/prisma/schema.prisma`
- **Prisma config**: `prisma.config.ts` (Prisma 7 uses `defineConfig`)
- **Generated client**: `src/generated/prisma` — treated as build artifact, never edit directly

## Key conventions

- **CommonJS** — no `"type": "module"` in package.json; `tsc` emits CommonJS (`require()`/`exports`)
- **Path alias**: `~/*` maps to `src/*` via tsconfig `paths`; all source imports use the `~/` alias (no relative imports in non-generated code). `tsc-alias` rewrites aliases to relative paths in the emitted `dist/`
- **Generated client** `src/generated/prisma` uses its own relative `.js` imports and `@ts-nocheck` — never edit directly
- **Vitest** — `yarn test` (`vitest run`) or `yarn test:watch`. Tests are colocated as `src/**/*.test.ts` so `yarn lint` and `yarn typecheck` cover them; `tsconfig.build.json` keeps them out of `dist/`. Config lives in `vitest.config.mts`, with `vitest.setup.mts` filling in the secrets `src/config/enviroment.ts` throws without
- **No CI** — no `.github/` workflows. Before pushing: `docker compose exec api sh -c "yarn lint && yarn typecheck && yarn test"`
- **ESLint 10 flat config** — ignores `dist/` and `src/generated/`
- **Prettier** — `.prettierrc.json` (80 cols, single quotes, no trailing commas). `src/` is clean; run `npx prettier --write` on files you touch
- **2-space indent**, trailing whitespace trimmed (per `.vscode/settings.json`)
- Response envelope: `{ status: "success", data: {} }` or `{ status: "error", message: "...", code: "..." }` — `code` is from `src/api/errors/error-codes.ts`

## Prisma (v7)

- Config file `prisma.config.ts` is required by Prisma 7 — do not use `prisma/schema.prisma` directly with CLI flags
- Schema: `src/prisma/schema.prisma`, migrations: `src/prisma/migrations`
- After schema changes: `docker compose exec api yarn prisma migrate dev --name <desc>` then `docker compose exec api yarn db:generate`
- Commit migration directories — production runs `prisma migrate deploy`
- Never run `migrate dev` against production

## Database

- Local: the `db` service in `docker-compose.dev.yml`, published on `localhost:5433` (`POSTGRES_PORT`)
- Inside Compose, `DATABASE_URL` is overridden to the `db` hostname; the value in `.env` (`localhost:5433`) is only for the Prisma CLI run from the host
- Postgres uses the `pgvector/pgvector:pg16` image — the `vector` extension enables semantic search on `Passage.embedding`
- `Passage.embedding` is `vector(1024)`, set by `MODEL_EMBEDDING_DIMENSIONS`. Both environments use `bge-m3`: local development through host Ollama, production through Cloudflare Workers AI (`@cf/baai/bge-m3`, OpenAI-compatible endpoint). It is natively 1024-wide, so `MODEL_EMBEDDING_SEND_DIMENSIONS` stays off. Changing the model or the width needs a full re-index (`yarn reingest`), and a width change also needs a migration on that column — vectors from different models are not comparable, and pgvector rejects a mismatched width outright
- Retrieval is hybrid: `Passage.embedding` (hnsw, cosine) fused with the generated `Passage.searchVector` tsvector (GIN) via Reciprocal Rank Fusion in `passage.repository.ts#searchHybrid`
- Models: `User`, `ResearchSpace`, `Source`, `Passage`, `Conversation`, `Note`, `Notebook`, `Citation`, `NoteCitation`

## Docker

- One multi-stage `Dockerfile`: `deps` → `dev` (tsx watch), and `deps` → `builder` (prisma generate + tsc) → `runner`. The default target is `runner`, the production image; `docker-compose.dev.yml` asks for `target: dev`
- There is no plain `docker-compose.yml`. `.env` sets `COMPOSE_FILE` — `docker-compose.dev.yml` locally, `docker-compose.prod.yml` on the VPS — so bare `docker compose` commands pick the right stack
- The runner image omits the Prisma CLI. In production the one-shot `folio-migrate` service runs `yarn db:migrate-prod` from the `builder` stage before `folio-backend` and `folio-worker` start
- The runner image listens on `3001` (`ENV PORT=3001`), where nginx proxies. Never set `PORT` in the production `.env` — `env_file` outranks the image's `ENV`
