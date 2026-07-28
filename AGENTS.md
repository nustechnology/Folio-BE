# AGENTS.md — Express + Prisma + PostgreSQL

## Quick start

```bash
cp .env.example .env      # then edit DATABASE_URL and JWT_TOKEN_SECRET
nvm use                    # Node 22.17
yarn install
docker compose -f docker-compose-local.yml up -d db adminer  # start Postgres + Adminer
yarn db:generate           # generate Prisma Client
yarn db:migrate            # create/apply dev migrations
yarn dev                   # starts tsx watch on src/index.ts
```

## Commands

| Command | Purpose |
|---------|---------|
| `yarn dev` | dev server with file watching (tsx watch) |
| `yarn build` | clean rebuild: `tsc --build --clean && tsc` |
| `yarn lint` | ESLint on `src/**/*.ts` |
| `yarn db:generate` | `prisma generate` (output: `src/generated/prisma`) |
| `yarn db:migrate` | `prisma migrate dev` (interactive, prompts for name) |
| `yarn db:migrate-prod` | `prisma migrate deploy` (apply committed migrations only) |
| `yarn db:seed` | `ts-node src/prisma/seeds/*.ts` |

## Architecture

```
router (validate + middleware) → handler (business logic) → repository (Prisma queries)
```

Routers are thin (Joi validation, middleware composition, response). Handlers contain application logic. Repositories contain database queries. No service layer.

- **Entrypoint**: `src/index.ts`
- **Express app**: `src/api/index.ts` — mounts `/api/v1`, Swagger UI at `/api-docs`, global error middleware
- **Routes**: `src/api/routes/index.ts` — mounts `auth`, `users`, `posts`, `comments`
- **Config**: `src/config/enviroment.ts` (note: misspelled filename), `logger.ts`, `request-context.ts`
- **Prisma schema**: `src/prisma/schema.prisma`
- **Prisma config**: `prisma.config.ts` (Prisma 7 uses `defineConfig`)
- **Generated client**: `src/generated/prisma` — treated as build artifact, never edit directly

## Key conventions

- **ESM** (`"type": "module"`) — all relative imports must include `.js` extension (e.g. `import './foo.js'`)
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

- Local: `docker compose -f docker-compose-local.yml up -d db adminer`
- `DATABASE_URL` uses host `localhost` for host-based dev, `db` when running inside Compose
- Adminer at `localhost:8080`
- Models: `User`, `Post`, `Comment`

## Docker

- `docker compose -f docker-compose-local.yml up --build` runs everything
- `docker build --target production -t nus-express-api .` for production image
- Production image omits Prisma CLI — run migrations separately in CI/release step
