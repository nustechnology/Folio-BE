# Layered Request Flow Design

## Objective

Improve the API's separation of responsibilities so each request follows a
consistent, scalable flow:

```txt
route → validation middleware → controller → service → repository
```

This phase establishes those boundaries for authentication, users, posts, and
comments without reorganizing the code into feature-based folders.

## Current State

The existing route callbacks combine route declaration, Joi validation,
request parsing, service invocation, response formatting, and asynchronous
error forwarding. Files under `src/api/handlers` already contain business
logic and delegate database access to repositories, so they are services in
practice despite their names.

The refactor will separate these existing responsibilities rather than add a
new domain abstraction.

## Scope

### Included

- Add reusable body and path-parameter validation middleware.
- Add a reusable asynchronous controller wrapper.
- Add controllers for auth, user, post, and comment endpoints.
- Rename the four handler files and exports from `handler` to `service`.
- Reduce route files to paths, HTTP methods, middleware composition, and
  controller binding.
- Convert request-validation failures to `AppError` with HTTP status `400`.
- Preserve existing successful endpoint URLs, response status codes, and
  response envelopes.
- Preserve the existing repository implementations and Prisma schema.

### Excluded

- Moving files into `src/modules/*`.
- Adding a test framework or test dependencies.
- Changing repository behavior or database queries.
- Adding pagination, authorization rules, security packages, database indexes,
  environment validation, transactions, or graceful shutdown.
- Changing domain-error behavior, including the current invalid-credentials
  response.
- Renaming or otherwise cleaning up unrelated code.

## Responsibilities

### Routes

Each route file will only:

- declare its URL and HTTP method;
- compose authentication and validation middleware;
- bind an asynchronous controller through `asyncHandler`.

Routes will not validate data, parse identifiers, call services, format
responses, or contain `try/catch` blocks.

### Validation middleware

Two middleware factories will cover the request inputs used in this phase:

- `validateBody(schema)` validates `req.body`;
- `validateParams(schema)` validates `req.params`.

Each factory awaits Joi validation with `abortEarly: false`, assigns the
validated value back to the corresponding request property, and calls `next()`.
This assignment ensures Joi conversions and defaults are visible to the
controller. A Joi validation failure is forwarded as an `AppError` with status
`400`; an unexpected failure is forwarded unchanged.

The existing body schemas remain authoritative. A user-ID parameter schema
will accept either `me` or a positive integer represented as a string. The
controller will resolve `me` to the authenticated user ID and convert a numeric
string to a number.

### Controllers

There will be one controller file per existing route file. Controllers depend
on Express types, the corresponding service, and `successResponse`. Each
controller will:

- read already validated input and `req.userId` where required;
- translate HTTP-oriented input into service arguments;
- await exactly one service operation;
- return the existing success response envelope.

Controllers will not import Joi, repositories, Prisma, hashing, JWT utilities,
or configuration.

### Services

The files currently named `*.handler.ts` will become `*.service.ts`. Their
business logic and public operations will remain the same:

- `AuthService.signUp` and `AuthService.login`;
- `UserService.getOne` and `UserService.update`;
- `PostService.getUserPosts` and `PostService.createPost`;
- `CommentService.getUserComments` and `CommentService.createComment`.

Services will not import Express types or format HTTP responses. They continue
to call repositories and, for authentication, hashing and token utilities.

### Repositories

Repositories remain the only layer that directly uses Prisma. This phase does
not alter their file locations, exported operations, queries, or client setup.

## Request Flow

For a validated authenticated request such as `POST /api/v1/posts`:

1. Express matches the route.
2. `auth` verifies the bearer token and assigns `req.userId`.
3. `validateBody(createPostSchema)` validates and replaces `req.body`.
4. `asyncHandler(PostController.createPost)` invokes the controller.
5. The controller passes the user ID, title, and content to
   `PostService.createPost`.
6. The service builds the repository payload and calls `PostRepository.create`.
7. The controller returns `{ status: 'success', data: { post } }` with status
   `200` through `successResponse`.

The same dependency direction applies to every migrated endpoint. Lower layers
never call upward into controllers or routes.

## Error Flow

- Authentication middleware continues forwarding `AppError` with status `401`.
- Validation middleware converts Joi validation errors to `AppError` with
  status `400` and uses Joi's combined validation message.
- `asyncHandler` catches rejected controller promises and calls `next(error)`.
- Services and repositories continue throwing their current errors.
- The existing global error middleware remains the single component that logs
  errors and writes error responses.
- Controllers and routes do not catch errors locally.

## Public API Compatibility

The following successful contracts remain unchanged:

- `POST /api/v1/auth/sign-up` returns `{ status, data: { user } }`.
- `POST /api/v1/auth/login` returns `{ status, data: { token } }`.
- `GET /api/v1/users/:id` returns `{ status, data: { user } }`.
- `PUT /api/v1/users/profile` returns `{ status, data: { user } }`.
- `GET /api/v1/posts` returns `{ status, data: { posts } }`.
- `POST /api/v1/posts` returns `{ status, data: { post } }`.
- `GET /api/v1/comments` returns `{ status, data: { comments } }`.
- `POST /api/v1/comments` returns `{ status, data: { comment } }`.

Invalid request bodies and invalid user path parameters will consistently
return HTTP `400` through the existing error response envelope. This is the
only intentional error-contract change in this phase.

## File Layout

The phase will add or change files within the existing layer-based layout:

```txt
src/api/
├── controllers/
│   ├── auth.controller.ts
│   ├── comment.controller.ts
│   ├── post.controller.ts
│   └── user.controller.ts
├── middlewares/
│   ├── async-handler.middleware.ts
│   └── validation.middleware.ts
├── routes/
│   ├── auth.router.ts
│   ├── comment.router.ts
│   ├── post.router.ts
│   ├── user.router.ts
│   └── validators/
└── services/
    ├── auth.service.ts
    ├── comment.service.ts
    ├── post.service.ts
    └── user.service.ts
```

The obsolete `src/api/handlers/*.handler.ts` files will be removed after their
logic has moved to the service files and all imports have been updated.

## Verification

The repository has no test framework, and this phase will not introduce one.
Verification will consist of:

1. `yarn lint` completing without errors.
2. `yarn build` completing without TypeScript errors.
3. A source audit confirming that route files contain no Joi validation calls,
   service calls, response formatting, or local asynchronous `try/catch` blocks.
4. A source audit confirming controllers do not import repositories or Prisma.
5. A source audit confirming services do not import Express.
6. A route-contract comparison covering every endpoint listed under Public API
   Compatibility.

## Acceptance Criteria

- All eight existing endpoints use the layered request flow defined above.
- Route files are declarative and bind controllers through `asyncHandler`.
- All request-body and user-ID parameter validation runs before controllers.
- Controllers contain HTTP translation only and never access repositories.
- Services contain the former handler logic and never depend on Express.
- Repositories remain the sole Prisma access layer.
- Successful public API contracts remain unchanged.
- Validation failures use the standard error envelope with HTTP `400`.
- Lint and TypeScript build checks pass.
