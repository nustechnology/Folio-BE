# Folio-BE

TypeScript REST API template using Express, Prisma ORM, PostgreSQL, Joi validation, JWT authentication, and Docker Compose.

## Technology

- Node.js 22 and TypeScript
- Express 4
- Prisma ORM 7 with the PostgreSQL driver adapter
- PostgreSQL 16
- Joi request validation
- JWT authentication
- bcrypt password hashing
- ESLint 10
- Docker Compose and Adminer

## Prerequisites

For host-based development:

- Node.js 22 (`.nvmrc` is included)
- Yarn 1.x
- Docker with Docker Compose, or another PostgreSQL server

For fully containerized development, only Docker with Docker Compose is required.

## Environment configuration

Copy the example file:

```bash
cp .env.example .env
```

The application uses these variables:

| Variable | Purpose | Local example |
| --- | --- | --- |
| `NODE_ENV` | Runtime environment | `development` |
| `PORT` | HTTP server port | `4000` |
| `LOG_LEVEL` | Minimum Winston log level | `debug` locally, `info` in production |
| `DATABASE_URL` | Direct PostgreSQL connection used by Prisma Client and Prisma CLI | `postgresql://nus:nus_local_password@localhost:5432/nus_express_template` |
| `JWT_TOKEN_SECRET` | Secret used to sign and verify access tokens | Use a long random value |

The `POSTGRES_*`, `POSTGRES_PORT`, and `ADMINER_PORT` variables in `.env.example` are optional overrides for Docker Compose.

Do not commit `.env`. Use separate secrets for each deployed environment.

## Start development on the host

### 1. Install dependencies

```bash
nvm use
yarn install
```

### 2. Start PostgreSQL

Start only the database and Adminer:

```bash
docker compose -f docker-compose-local.yml up -d db adminer
```

PostgreSQL is available at `localhost:5432`. Adminer is available at [http://localhost:8080](http://localhost:8080).

Default Adminer connection values:

| Field | Value |
| --- | --- |
| System | PostgreSQL |
| Server | `db` when using Adminer in Compose |
| Username | `nus` |
| Password | `nus_local_password` |
| Database | `nus_express_template` |

### 3. Generate Prisma Client and apply migrations

```bash
yarn db:generate
yarn db:migrate
```

`yarn db:migrate` runs Prisma's development migration workflow. If Prisma detects schema changes, provide a descriptive migration name when prompted.

### 4. Start the API

```bash
yarn dev
```

The API listens on [http://localhost:4000](http://localhost:4000) by default. Source changes restart the process through `tsx watch`.

Interactive Swagger documentation is available at [http://localhost:4000/api-docs](http://localhost:4000/api-docs). The raw OpenAPI document is available at [http://localhost:4000/api-docs.json](http://localhost:4000/api-docs.json).

## Start everything with Docker

Build and start the API, PostgreSQL, and Adminer:

```bash
docker compose -f docker-compose-local.yml up --build
```

The API container waits for PostgreSQL, generates Prisma Client, applies committed migrations, and starts the development watcher.

Run the stack in the background:

```bash
docker compose -f docker-compose-local.yml up -d --build
```

Useful local Docker commands:

```bash
# Follow API logs
docker compose -f docker-compose-local.yml logs -f api

# Show service status
docker compose -f docker-compose-local.yml ps

# Run Prisma commands inside the API container
docker compose -f docker-compose-local.yml exec api yarn prisma migrate dev --name describe_change

# Restart only the API
docker compose -f docker-compose-local.yml restart api

# Stop containers but retain database data
docker compose -f docker-compose-local.yml down

# Stop containers and delete local database data
docker compose -f docker-compose-local.yml down -v
```

When the API runs inside Compose, its database host is `db`. When it runs directly on your machine, its database host is `localhost`.

## Package commands

| Command | Purpose |
| --- | --- |
| `yarn dev` | Start the API with file watching |
| `yarn build` | Compile TypeScript to `dist/` |
| `yarn lint` | Run ESLint |
| `yarn db:generate` | Generate Prisma Client from the schema |
| `yarn db:migrate` | Create/apply development migrations |
| `yarn db:migrate-prod` | Apply committed migrations without creating new ones |
| `yarn db:seed` | Run seed scripts from `src/prisma/seeds/` |

Run the compiled application with:

```bash
yarn build
node dist/index.js
```

## API

Base URL:

```text
http://localhost:4000/api/v1
```

Use the Swagger UI at `/api-docs` to inspect schemas, execute requests, and authorize protected endpoints. After logging in, select **Authorize** and enter the returned JWT. Swagger UI adds the `Bearer` prefix automatically.

### Create an account

```http
POST /api/v1/auth/sign-up
Content-Type: application/json
```

```json
{
  "name": "alice",
  "email": "alice@example.com",
  "password": "password123"
}
```

The current validator requires a name (1-100 characters), a valid email, and a password (minimum 8 characters).

### Log in

```http
POST /api/v1/auth/login
Content-Type: application/json
```

```json
{
  "email": "alice@example.com",
  "password": "password123"
}
```

Successful login returns a JWT valid for one day.

### Get the authenticated user

```http
GET /api/v1/users/me
Authorization: Bearer <token>
```

An authenticated request may also retrieve a user by numeric ID:

```http
GET /api/v1/users/1
Authorization: Bearer <token>
```

### Available endpoints

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/v1/auth/sign-up` | No | Create an account |
| `POST` | `/api/v1/auth/login` | No | Return a one-day JWT |
| `GET` | `/api/v1/users/:id` | Bearer token | Get a user by numeric ID or `me` |
| `PUT` | `/api/v1/users/profile` | Bearer token | Update the authenticated user's name, email, or address |
| `GET` | `/health` | No | Return service health and the current timestamp |

See `/api-docs` for request schemas and interactive examples.

Successful responses use:

```json
{
  "status": "success",
  "data": {}
}
```

Error responses use:

```json
{
  "status": "error",
  "message": "Error description"
}
```

## Logging

The API uses Winston for structured application and HTTP logging.

- Development logs are colorized and human-readable.
- Production logs are JSON so Docker or the deployment platform can collect and index them.
- Every request receives an `x-request-id` response header.
- An incoming `x-request-id` is reused when it is no longer than 128 characters; otherwise the API generates a UUID.
- Request context is preserved across asynchronous handlers with `AsyncLocalStorage`.
- Completed request logs include method, path, status code, duration, request ID, and authenticated user ID when available.
- Central error middleware logs the complete stack. Expected `4xx` errors use `warn`; unexpected `5xx` errors use `error`.
- Production HTTP responses do not expose stack traces, and unexpected `5xx` responses use a generic message.

Set the minimum level with `LOG_LEVEL`. Winston's default levels used by this project include:

| Level | Intended usage |
| --- | --- |
| `error` | Failed operations and unexpected exceptions |
| `warn` | Recoverable or suspicious conditions |
| `info` | Startup and important application events |
| `http` | Completed HTTP requests |
| `debug` | Local diagnostic detail |

Example production log:

```json
{
  "level": "http",
  "message": "HTTP request completed",
  "method": "GET",
  "path": "/api/v1/users/me",
  "statusCode": 200,
  "durationMs": 12.45,
  "requestId": "98c87641-5d04-4ca1-b6bc-15afbfc0bc94",
  "userId": 1,
  "service": "nus-express-api",
  "timestamp": "2026-06-23T04:00:00.000Z"
}
```

Do not log passwords, JWTs, authorization headers, secrets, full database URLs, or sensitive request bodies.

## Architecture

The code uses a small layered architecture:

```text
HTTP request
    |
    v
Express router
    |-- validate request with Joi
    |-- authenticate with middleware when required
    v
Controller
    |-- translate HTTP input and output
    |-- call the relevant service
    v
Service
    |-- execute application logic
    |-- hash passwords or create JWTs
    v
Repository
    |-- execute Prisma queries
    |-- remove sensitive fields
    v
PostgreSQL
```

### Directory structure

```text
.
├── prisma.config.ts                 # Prisma CLI schema, migration, and database configuration
├── src
│   ├── index.ts                     # Process entry point and HTTP listener
│   ├── api
│   │   ├── index.ts                 # Express application and global middleware
│   │   ├── docs                     # OpenAPI specification used by Swagger UI
│   │   ├── routes                   # Route definitions, validators, and response helpers
│   │   ├── controllers              # HTTP input/output orchestration
│   │   ├── services                 # Business and application logic
│   │   ├── errors                   # Application errors with HTTP status codes
│   │   └── middlewares              # Cross-cutting request middleware
│   ├── config
│   │   ├── enviroment.ts            # Environment variable loading
│   │   ├── logger.ts                # Winston formats, levels, and console transport
│   │   └── request-context.ts        # Async request ID context
│   ├── prisma
│   │   ├── schema.prisma            # Database models and Prisma Client generator
│   │   ├── migrations               # Versioned database migrations
│   │   └── repositories             # Database access
│   └── generated/prisma             # Generated Prisma Client; do not edit manually
├── Dockerfile
└── docker-compose-local.yml
```

### Request lifecycle

For `GET /api/v1/users/me`:

1. `src/api/index.ts` mounts the versioned router at `/api/v1`.
2. Request logging middleware creates or accepts a request ID and starts timing.
3. `src/api/routes/index.ts` routes `/users` to `user.router.ts`.
4. `auth.middleware.ts` reads the bearer token, verifies it, and sets `req.userId`.
5. `user.router.ts` validates the path parameter and dispatches the request to the controller.
6. `user.controller.ts` converts `me` to the authenticated user ID, calls the service, and selects the response shape.
7. `user.service.ts` coordinates the use case.
8. `user.repository.ts` queries PostgreSQL through Prisma and removes the password.
9. `response.ts` produces the JSON HTTP response.
10. Winston records the completed request. Errors are passed to centralized error middleware and logged once.

For authentication requests, the route first validates the body with Joi. The authentication service hashes passwords during sign-up and signs JWTs during login.

## Coding pattern

Follow the existing responsibilities when adding a feature:

1. Define or update database models in `src/prisma/schema.prisma`.
2. Create a migration and regenerate Prisma Client.
3. Put database queries in a repository under `src/prisma/repositories`.
4. Put business/application logic in a service under `src/api/services`.
5. Put HTTP request and response orchestration in a controller under `src/api/controllers`.
6. Put validation and middleware composition in a router.
7. Mount the router in `src/api/routes/index.ts`.
8. Run lint and build before committing.

Example:

```bash
yarn prisma migrate dev --name add_post_status
yarn db:generate
yarn lint
yarn build
```

Project conventions:

- Use ESM imports. Relative TypeScript imports include the emitted `.js` extension.
- Routers should remain thin and HTTP-focused.
- Controllers should translate HTTP input/output and delegate application logic to services.
- Services should not contain raw database queries.
- Repositories should not decide HTTP status codes or send responses.
- Validate untrusted request input before calling controllers.
- Never return password hashes or include them in JWT payloads.
- Add authenticated routes behind `auth`.
- Treat generated Prisma files as build artifacts; change the schema and regenerate instead of editing them.
- Commit migration directories so production can run `prisma migrate deploy`.

## Database changes

Development workflow:

```bash
# Edit src/prisma/schema.prisma first
yarn prisma migrate dev --name describe_change
yarn db:generate
```

Production workflow:

```bash
yarn prisma migrate deploy
```

`prisma migrate deploy` applies committed migrations only. Do not run `migrate dev` against a production database.

## Deployment guidance

The simplest production topology is:

```text
Load balancer / platform HTTPS
            |
            v
Node.js API container
            |
            v
Managed PostgreSQL
```

Suitable deployment options include Render, Railway, Fly.io, Google Cloud Run, AWS ECS/Fargate, or a Kubernetes platform. Prefer a managed PostgreSQL service with backups, monitoring, and restricted network access.

For production:

1. Build the `production` target from `Dockerfile`.
2. Provide `DATABASE_URL`, `JWT_TOKEN_SECRET`, `PORT`, `LOG_LEVEL=info`, and `NODE_ENV=production` through the platform's secret/configuration system.
3. Run `yarn prisma migrate deploy` from CI or a release job that installs development dependencies.
4. Start the image with its default `node dist/index.js` command.
5. Terminate HTTPS at the platform load balancer or ingress.
6. Use the existing `/health` endpoint for automated container or platform health checks.
7. Send logs to the platform's log system and do not expose Adminer publicly.

Build the production image locally:

```bash
docker build --target production -t nus-express-api .
```

Run it against an accessible PostgreSQL instance:

```bash
docker run --rm \
  -p 4000:4000 \
  -e NODE_ENV=production \
  -e PORT=4000 \
  -e LOG_LEVEL=info \
  -e DATABASE_URL='postgresql://user:password@host:5432/database' \
  -e JWT_TOKEN_SECRET='replace-with-a-production-secret' \
  nus-express-api
```

The slim production image does not include the Prisma CLI and does not automatically run migrations. Keep schema changes in a separate CI/release step so migration failures do not race across multiple API replicas.
