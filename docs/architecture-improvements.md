# Architecture Improvement Suggestions

This document records suggested improvements for scaling the current Node.js/Express.js + Prisma project architecture.

## Current architecture

The project currently follows this pattern:

```txt
Router → Handler → Repository → Prisma/PostgreSQL
```

This is a good lightweight structure for a small API. For larger teams, more modules, and more business logic, the project can be improved with stronger separation of responsibilities and more scalable conventions.

---

## 1. Use module-based folder structure

Current structure is mostly layer-based:

```txt
src/api/routes
src/api/handlers
src/prisma/repositories
```

For better scaling, move toward feature/module-based organization:

```txt
src/modules/users/
├── user.routes.ts
├── user.controller.ts
├── user.service.ts
├── user.repository.ts
├── user.validator.ts
└── user.types.ts

src/modules/auth/
src/modules/posts/
src/modules/comments/
```

Benefits:

- Easier to find all files related to one feature.
- Reduces cross-folder navigation.
- Easier to split modules later.
- Better for larger teams.

Suggested request flow:

```txt
routes → controllers → services/use-cases → repositories
```

---

## 2. Keep routers thin

Routers should only define:

- URL paths
- HTTP methods
- middleware composition
- validation middleware
- controller binding

Avoid putting business logic or complex request processing directly in route files.

Example target style:

```ts
router.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(AuthController.login)
);
```

---

## 3. Add controller layer

Current route files also behave like controllers.

For larger apps, introduce controllers:

```txt
route → controller → service → repository
```

Controller responsibilities:

- Read validated request data.
- Call service/use-case logic.
- Return HTTP response.
- Avoid direct database access.

Example:

```ts
export const login = async (req: Request, res: Response) => {
  const token = await AuthService.login(req.body);
  return successResponse(res, { token });
};
```

---

## 4. Rename handlers to services/use-cases when logic grows

The current `handler` layer already contains business logic.

For clearer convention, consider renaming:

```txt
handler → service
```

or, for more explicit business actions:

```txt
handler → use-case
```

Examples:

```txt
auth.service.ts
post.service.ts
comment.service.ts
```

This is not urgent, but it makes the architecture more recognizable to Node.js/Express.js developers.

---

## 5. Add centralized async route handler

Current routes repeat this pattern:

```ts
try {
  // handler logic
} catch (err) {
  next(err);
}
```

Add a reusable `asyncHandler` utility:

```ts
import { NextFunction, Request, Response } from 'express';

export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
```

Then routes become cleaner:

```ts
router.post('/login', asyncHandler(AuthController.login));
```

Benefits:

- Less repeated boilerplate.
- Lower risk of missing `next(err)`.
- Cleaner route definitions.

---

## 6. Move validation into middleware

Current validation happens inside route handlers:

```ts
const validBody = await loginSchema.validateAsync(req.body);
```

Create reusable validation middleware:

```txt
validateBody(schema)
validateParams(schema)
validateQuery(schema)
```

Example usage:

```ts
router.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(AuthController.login)
);
```

Benefits:

- Keeps routes declarative.
- Standardizes validation errors.
- Makes validation reusable.

---

## 7. Add authorization layer

The current app has authentication middleware, but authorization rules should become explicit as the app grows.

Examples:

```txt
requireAuth
requireRole('admin')
requireOwnership('post')
canDeletePost
canUpdateComment
```

Example usage:

```ts
router.delete(
  '/:id',
  auth,
  canDeletePost,
  asyncHandler(PostController.delete)
);
```

This is important when adding:

- admin users
- roles
- teams
- ownership checks
- private/public resources

---

## 8. Add pagination and filtering conventions

Avoid unbounded queries such as returning all posts or comments.

Recommended API style:

```txt
GET /posts?page=1&limit=20
GET /comments?postId=1&page=1&limit=20
```

Recommended response format:

```json
{
  "status": "success",
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100
    }
  }
}
```

Benefits:

- Prevents large memory usage.
- Improves database performance.
- Makes frontend consumption easier.

---

## 9. Add database indexes

The Prisma schema has relations, but foreign keys should have explicit indexes for performance.

Recommended additions:

```prisma
model Post {
  id       Int @id @default(autoincrement())
  authorId Int
  author   User @relation(fields: [authorId], references: [id])

  @@index([authorId])
}

model Comment {
  id     Int @id @default(autoincrement())
  postId Int
  userId Int

  @@index([postId])
  @@index([userId])
}
```

Benefits:

- Faster lookups by user.
- Faster post/comment queries.
- Better performance as data grows.

---

## 10. Use domain-specific errors

Avoid generic errors for expected application cases.

Current style in some places:

```ts
throw Error('Email or Password is not correct');
```

Better:

```ts
throw new AppError('Invalid credentials', 401);
throw new AppError('User not found', 404);
throw new AppError('Forbidden', 403);
```

Benefits:

- More accurate HTTP status codes.
- Cleaner error handling.
- Less risk of exposing internal errors.

---

## 11. Add security middleware

Recommended packages:

```bash
yarn add helmet express-rate-limit
```

Use globally:

```ts
app.use(helmet());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
```

Use stricter rate limits for auth routes:

```txt
POST /auth/login
POST /auth/sign-up
```

Benefits:

- Adds secure HTTP headers.
- Reduces brute-force risk.
- Improves baseline API security.

---

## 12. Move CORS middleware before routes

Current app registers CORS after routes. It should be applied before API routes.

Recommended order:

```ts
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/v1', routes);
```

Benefits:

- Ensures CORS headers are applied to API responses.
- Handles browser preflight requests correctly.

---

## 13. Add environment validation

Validate required environment variables at startup.

Required variables include:

```txt
DATABASE_URL
JWT_TOKEN_SECRET
PORT
NODE_ENV
LOG_LEVEL
```

Recommended tools:

- Joi
- Zod
- envalid

Benefits:

- App fails fast on bad configuration.
- Avoids runtime surprises.
- Makes deployment safer.

---

## 14. Add testing structure

No test framework is currently configured.

Recommended test types:

- unit tests for services/use-cases
- integration tests for repositories
- API tests for routes/controllers
- auth and authorization tests
- validation failure tests

Suggested tools:

```txt
Vitest or Jest
Supertest
Testcontainers or dedicated test PostgreSQL database
```

Suggested structure:

```txt
src/modules/auth/auth.service.test.ts
src/modules/users/user.controller.test.ts
src/modules/posts/post.repository.test.ts
```

---

## 15. Use Prisma transactions for multi-step operations

When a business action affects multiple tables, use transactions.

Example:

```ts
await prisma.$transaction(async tx => {
  // create/update multiple records safely
});
```

Useful for:

- creating related records
- deleting users with related data
- audit logging
- payment/order-like workflows

Benefits:

- Prevents partial writes.
- Keeps data consistent.
- Makes complex operations safer.

---

## 16. Add graceful shutdown

The app currently handles uncaught exceptions and unhandled rejections, but should also handle process shutdown signals.

Handle:

```txt
SIGTERM
SIGINT
```

Recommended behavior:

- stop accepting new HTTP requests
- finish active requests where possible
- close Prisma/database connections
- exit cleanly

Benefits:

- Safer Docker/Kubernetes deployments.
- Prevents abrupt request termination.
- Reduces database connection leaks.

---

## Suggested target structure

```txt
src/
├── app.ts                         # Express app setup
├── server.ts                      # HTTP server startup/shutdown
├── config/
│   ├── environment.ts
│   ├── logger.ts
│   └── request-context.ts
├── shared/
│   ├── errors/
│   ├── middlewares/
│   ├── utils/
│   └── types/
├── modules/
│   ├── auth/
│   │   ├── auth.routes.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── auth.validator.ts
│   │   └── auth.types.ts
│   ├── users/
│   ├── posts/
│   └── comments/
└── prisma/
    ├── schema.prisma
    ├── migrations/
    ├── client.ts
    └── repositories/
```

---

## Recommended priority order

### High priority

1. Move `cors()` before routes.
2. Add `asyncHandler` utility.
3. Add validation middleware.
4. Use `AppError` for domain errors.
5. Add security middleware: `helmet` and `express-rate-limit`.
6. Add Prisma indexes for foreign keys.

### Medium priority

1. Move toward module-based folders.
2. Add controller layer.
3. Standardize pagination and filtering.
4. Add environment validation.
5. Add graceful shutdown.

### Long-term priority

1. Add test framework and test structure.
2. Add authorization middleware.
3. Use transactions for complex workflows.
4. Consider clearer naming: `handler` → `service` or `use-case`.
