# syntax=docker/dockerfile:1

# Folio backend — one image definition for every environment.
#
#   deps    — Yarn 4 install including devDependencies (tsc, tsx, prisma)
#   dev     — deps plus the source tree, running `yarn dev` under tsx watch.
#             Used by docker-compose.dev.yml, which bind-mounts ./src over the
#             baked copy so edits on the host reload inside the container.
#   builder — prisma generate + tsc + tsc-alias. Also the stage the one-shot
#             migrate service runs from, since `prisma migrate deploy` needs the
#             Prisma CLI that the runtime stage deliberately omits.
#   runner  — production dependencies only, non-root, no build toolchain
#
# The default target is `runner`: a bare `docker build .` produces the
# production image, and only dev asks for a stage by name.
#
# Node is pinned to the 22 line to match .nvmrc (v22.17.1).

FROM node:22-alpine AS base
# Yarn 4 (yarn.lock carries __metadata.version 8), which the Yarn 1.x bundled in
# the image cannot read. Pinned explicitly — package.json has no packageManager.
RUN corepack enable && corepack prepare yarn@4.12.0 --activate
WORKDIR /app

# ---- dependencies -----------------------------------------------------------
FROM base AS deps
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

# ---- development ------------------------------------------------------------
# Not a parent of `builder`: dev carries the Prisma CLI's native toolchain and
# an unbuilt source tree, neither of which should reach a production layer.
FROM base AS dev
# `yarn dev` shells out to `prisma generate`, whose schema engine is a native
# binary linked against OpenSSL. Alpine does not ship it by default.
RUN apk add --no-cache openssl
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Matches the PORT default in .env.example. Compose publishes it; unlike the
# production stages this one is meant to be reachable from the host.
EXPOSE 3001
CMD ["yarn", "dev"]

# ---- build / migrations -----------------------------------------------------
FROM base AS builder
# Prisma's schema engine, which `migrate deploy` shells out to, is a native
# binary linked against OpenSSL. Alpine does not ship it by default.
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `yarn build` runs prisma generate, then tsc, then tsc-alias. Generation only
# parses the schema, so this URL is never connected to — it just satisfies the
# datasource block during the build.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" yarn build

# ---- runtime ----------------------------------------------------------------
FROM base AS runner
# @prisma/client is a production dependency, so its postinstall runs during the
# install below and would shell out to the Prisma CLI — a devDependency that is
# deliberately absent here.
ENV NODE_ENV=production \
    PORT=3001 \
    MULTER_TEMP_DIR=/app/tmp \
    PRISMA_SKIP_POSTINSTALL_GENERATE=true

COPY package.json yarn.lock .yarnrc.yml ./
# Production dependencies only: drops tsc, tsx, vitest, eslint and the Prisma
# CLI from the runtime image.
#
# @napi-rs/canvas is then deleted. pdfjs-dist requires it on import to polyfill
# DOMMatrix/Path2D, which only matter when rasterizing a page — parse.service.ts
# only calls getTextContent(). Its musl binding uses instructions this CPU lacks,
# so loading it killed the worker with SIGILL before any JS ran. pdfjs warns that
# it cannot polyfill the two globals and carries on without it.
RUN yarn workspaces focus --production && yarn cache clean \
    && rm -rf node_modules/@napi-rs

# The Prisma 7 client is generated as plain TypeScript into src/generated, so
# tsc compiles it to dist/generated along with everything else. No engine
# binaries and no schema file are needed at runtime — the pg driver adapter
# talks to Postgres directly.
COPY --from=builder --chown=node:node /app/dist ./dist

# multer stages uploads on disk here before they are streamed to MinIO. Created
# owned by `node` so the bind mount that replaces it inherits that ownership.
RUN mkdir -p /app/tmp && chown -R node:node /app/tmp

USER node

# Documentation only — no host port is published; Nginx reaches this by
# container name over the shared Docker network.
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:3001/health || exit 1

CMD ["node", "dist/index.js"]
