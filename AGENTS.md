# AGENTS.md — Express + Prisma + PostgreSQL

## Quick start

```bash
cp .env.example .env      # then edit DATABASE_URL and JWT_TOKEN_SECRET
nvm use                    # Node 22.17
yarn install
docker compose up -d db redis minio  # start Postgres (pgvector) + Redis + MinIO
yarn db:generate           # generate Prisma Client
yarn db:migrate            # create/apply dev migrations
yarn dev                   # starts tsx watch on src/index.ts
yarn dev:worker            # separate terminal: ingestion worker
```

## Commands

| Command | Purpose |
|---------|---------|
| `yarn dev` | dev server with file watching (tsx watch) |
| `yarn dev:worker` | ingestion worker (BullMQ + Redis) — run alongside `yarn dev` |
| `yarn build` | `yarn db:generate && tsc --build --clean && tsc && tsc-alias -f -fe .js` |
| `yarn lint` | ESLint on `src/**/*.ts` |
| `yarn db:generate` | `prisma generate` (output: `src/generated/prisma`) |
| `yarn db:migrate` | `prisma migrate dev` (interactive, prompts for name) |
| `yarn db:migrate-prod` | `prisma migrate deploy` (apply committed migrations only) |
| `yarn db:seed` | `tsx src/prisma/seeds/space.seed.ts` (tsx resolves `~/` aliases) |

## Architecture

```
router (validate + middleware) → controller → service → repository (Prisma queries)
```

Routers are thin (Joi validation, middleware composition, response). Controllers extract request data and return responses. Services contain business logic. Repositories contain database queries.

- **Entrypoint**: `src/index.ts`
- **Express app**: `src/api/index.ts` — mounts `/api/v1`, Swagger UI at `/api-docs`, global error middleware
- **Routes**: `src/api/routes/index.ts` — mounts `users`, `auth`, `spaces`, `sources`. `spaces` nests `notes`, `ask` and `conversations` under `/:spaceId`
- **Ask (grounded QA)**: `ask.service.ts` orchestrates one answer — scope resolution → `retrieval.service.ts` (hybrid search + citation locators) → `ask-prompt.service.ts` (prompt + answer post-processing) → `model-gateway.service.ts` (streamed completion). The controller owns the SSE transport via `sse.service.ts#openEventStream`; `ask-suggestion.service.ts` backs the empty-state chips
- **Ingestion worker**: `src/workers/ingestion.worker.ts` — separate process (`yarn dev:worker`); picks `ingestion` BullMQ jobs and runs extract → normalize → chunk → embed → index
- **Queue**: `src/queues/ingestion.queue.ts` — enqueues `{ sourceId }` jobs after source creation/retry
- **Config**: `src/config/enviroment.ts` (note: misspelled filename), `logger.ts`, `request-context.ts`, `redis.ts`, `minio.ts`
- **Prisma schema**: `src/prisma/schema.prisma`
- **Prisma config**: `prisma.config.ts` (Prisma 7 uses `defineConfig`)
- **Generated client**: `src/generated/prisma` — treated as build artifact, never edit directly

## Key conventions

- **CommonJS** — no `"type": "module"` in package.json; `tsc` emits CommonJS (`require()`/`exports`)
- **Path alias**: `~/*` maps to `src/*` via tsconfig `paths`; all source imports use the `~/` alias (no relative imports in non-generated code). `tsc-alias -f -fe .js` rewrites aliases to relative `.js` paths in the emitted `dist/`
- **Generated client** `src/generated/prisma` uses its own relative `.js` imports and `@ts-nocheck` — never edit directly
- **No test framework** — skip any test-related commands or assumptions
- **No CI** — no `.github/` workflows
- **ESLint 10 flat config** — ignores `dist/` and `src/generated/`
- **No formatter** (no Prettier)
- **2-space indent**, trailing whitespace trimmed (per `.vscode/settings.json`)
- Response envelope: `{ status: "success", data: {} }` or `{ status: "error", message: "..." }`

## Prisma (v7)

- Config file `prisma.config.ts` is required by Prisma 7 — do not use `prisma/schema.prisma` directly with CLI flags
- Schema: `src/prisma/schema.prisma`, migrations: `src/prisma/migrations`
- After schema changes: `yarn prisma migrate dev --name <desc>` then `yarn db:generate`
- Commit migration directories — production runs `prisma migrate deploy`
- Never run `migrate dev` against production

## Database

- Local: `docker compose up -d db redis minio`
- `DATABASE_URL` uses host `localhost` for host-based dev, `db` when running inside Compose
- Postgres uses the `pgvector/pgvector:pg16` image — the `vector` extension enables semantic search on `Passage.embedding`
- Retrieval is hybrid: `Passage.embedding` (ivfflat, cosine) fused with the generated `Passage.searchVector` tsvector (GIN) via Reciprocal Rank Fusion in `passage.repository.ts#searchHybrid`
- Adminer at `localhost:8080`
- Models: `User`, `ResearchSpace`, `Source`, `Passage`, `Conversation`, `Note`, `Notebook`, `Citation`, `NoteCitation`

## Docker

- `docker compose up -d db redis minio` runs the dev services
- `docker build --target production -t nus-express-api .` for production image
- Production image omits Prisma CLI — run migrations separately in CI/release step
