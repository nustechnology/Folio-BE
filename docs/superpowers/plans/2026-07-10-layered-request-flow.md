# Layered Request Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor all existing API endpoints to use `route → validation middleware → controller → service → repository` while preserving successful API contracts.

**Architecture:** Add shared request validation and asynchronous-handler middleware, extract HTTP translation into four controllers, and expose the existing handler logic as four services. Keep the current layer-based folders and Prisma repositories so this phase changes responsibility boundaries without combining them with a module-folder migration.

**Tech Stack:** Node.js 22.17, TypeScript 5.8, Express 4, Joi 17, Prisma 7, ESM with NodeNext resolution

## Global Constraints

- Do not move files into `src/modules/*` in this phase.
- Do not add dependencies or a test framework; this repository explicitly has no test framework.
- Keep all relative ESM imports suffixed with `.js`.
- Preserve all eight existing endpoint paths, successful status codes, and success response envelopes.
- The only intentional API behavior change is HTTP `400` for Joi request-validation failures.
- Do not change repository implementations, Prisma queries, the Prisma schema, or generated Prisma files.
- Do not change domain-error behavior, including invalid-login-credentials behavior.
- Use 2-space indentation and match the repository's existing TypeScript style.

---

### Task 1: Add shared request middleware and user parameter validation

**Files:**
- Create: `src/api/middlewares/async-handler.middleware.ts`
- Create: `src/api/middlewares/validation.middleware.ts`
- Modify: `src/api/routes/validators/user.validator.ts`

**Interfaces:**
- Consumes: Express `RequestHandler`, Joi `ObjectSchema`, and existing `AppError`.
- Produces: `asyncHandler(handler)`, `validateBody(schema)`, `validateParams(schema)`, and `userIdParamsSchema` for later route tasks.

- [x] **Step 1: Add the asynchronous controller wrapper**

Create `src/api/middlewares/async-handler.middleware.ts`:

```ts
import { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

export const asyncHandler = (handler: AsyncRequestHandler): RequestHandler => {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
};
```

- [x] **Step 2: Add request validation middleware**

Create `src/api/middlewares/validation.middleware.ts`:

```ts
import { NextFunction, RequestHandler } from 'express';
import Joi from 'joi';

import { AppError } from '../errors/app.error.js';

const forwardValidationError = (error: unknown, next: NextFunction) => {
  if (Joi.isError(error)) {
    next(new AppError(error.message, 400));
    return;
  }

  next(error);
};

export const validateBody = (schema: Joi.ObjectSchema): RequestHandler => {
  return async (req, _res, next) => {
    try {
      req.body = await schema.validateAsync(req.body, { abortEarly: false });
      next();
    } catch (error: unknown) {
      forwardValidationError(error, next);
    }
  };
};

export const validateParams = (schema: Joi.ObjectSchema): RequestHandler => {
  return async (req, _res, next) => {
    try {
      req.params = await schema.validateAsync(req.params, {
        abortEarly: false,
      });
      next();
    } catch (error: unknown) {
      forwardValidationError(error, next);
    }
  };
};
```

- [x] **Step 3: Add the user-ID path schema**

Update `src/api/routes/validators/user.validator.ts` to:

```ts
import Joi from 'joi';

export const userIdParamsSchema = Joi.object({
  id: Joi.string().pattern(/^(me|[1-9]\d*)$/).required(),
});

export const updateProfileSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  email: Joi.string().email().optional(),
  address: Joi.string().allow('').optional(),
}).min(1);
```

- [x] **Step 4: Verify the shared middleware compiles**

Run: `yarn build`

Expected: exit code `0` with no TypeScript errors.

- [x] **Step 5: Commit the shared middleware**

```bash
git add src/api/middlewares/async-handler.middleware.ts src/api/middlewares/validation.middleware.ts src/api/routes/validators/user.validator.ts
git commit -m "refactor: add request pipeline middleware"
```

### Task 2: Expose the business logic as services

**Files:**
- Create: `src/api/services/auth.service.ts`
- Create: `src/api/services/user.service.ts`
- Create: `src/api/services/post.service.ts`
- Create: `src/api/services/comment.service.ts`

**Interfaces:**
- Consumes: Existing repository exports, Prisma input types, auth configuration, bcrypt, and JWT.
- Produces: `AuthService`, `UserService`, `PostService`, and `CommentService` with the same operation signatures as the current handlers.

- [x] **Step 1: Add the authentication service**

Create `src/api/services/auth.service.ts`:

```ts
import { Prisma, User } from '../../generated/prisma/client.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import UserRepository from '../../prisma/repositories/user.repository.js';
import { env } from '../../config/enviroment.js';

const SALT_ROUND = 10;
const TOKEN_EXPIRATION = 60 * 60 * 24;

const signUp = async (payload: Prisma.UserCreateInput) => {
  const { name, email, password } = payload;

  const salt = await bcrypt.genSalt(SALT_ROUND);
  const hashPassword = await bcrypt.hash(password, salt);

  return UserRepository.create({
    name,
    email,
    password: hashPassword,
  });
};

const login = async (payload: { email: string; password: string }) => {
  const { email, password } = payload;
  const user = await UserRepository.findOneByEmail(email, {
    excludeSensitiveFields: false,
  }) as User;

  if (!user) {
    throw Error('Email or Password is not correct');
  }

  const checkPassword = await bcrypt.compare(password, user.password);

  if (!checkPassword) {
    throw Error('Email or Password is not correct');
  }

  return jwt.sign({ id: user.id }, env.JWT_TOKEN_SECRET, {
    expiresIn: TOKEN_EXPIRATION,
  });
};

export default {
  signUp,
  login,
};
```

- [x] **Step 2: Add the user service**

Create `src/api/services/user.service.ts`:

```ts
import UserRepository from '../../prisma/repositories/user.repository.js';

const getOne = async (id: number) => {
  return UserRepository.findOne(id);
};

const update = async (
  id: number,
  payload: { name?: string; email?: string; address?: string }
) => {
  return UserRepository.update(id, payload);
};

export default {
  getOne,
  update,
};
```

- [x] **Step 3: Add the post service**

Create `src/api/services/post.service.ts`:

```ts
import PostRepository from '../../prisma/repositories/post.repository.js';

const getUserPosts = async (userId: number) => {
  return PostRepository.getUserPosts(userId);
};

const createPost = async (
  userId: number,
  title: string,
  content: string
) => {
  return PostRepository.create({
    title,
    content,
    authorId: userId,
  });
};

export default {
  getUserPosts,
  createPost,
};
```

- [x] **Step 4: Add the comment service**

Create `src/api/services/comment.service.ts`:

```ts
import CommentRepository from '../../prisma/repositories/comment.repository.js';

const getUserComments = async (userId: number) => {
  return CommentRepository.getUserComments(userId);
};

const createComment = async (
  userId: number,
  postId: number,
  content: string
) => {
  return CommentRepository.create({
    content,
    userId,
    postId,
  });
};

export default {
  getUserComments,
  createComment,
};
```

- [x] **Step 5: Verify the services compile without Express dependencies**

Run: `yarn build`

Expected: exit code `0` with no TypeScript errors.

Run: `rg -n "from 'express'|from \"express\"" src/api/services`

Expected: no output and exit code `1`, proving the services do not import Express.

- [x] **Step 6: Commit the services**

```bash
git add src/api/services/auth.service.ts src/api/services/user.service.ts src/api/services/post.service.ts src/api/services/comment.service.ts
git commit -m "refactor: expose application services"
```

### Task 3: Add HTTP controllers

**Files:**
- Create: `src/api/controllers/auth.controller.ts`
- Create: `src/api/controllers/user.controller.ts`
- Create: `src/api/controllers/post.controller.ts`
- Create: `src/api/controllers/comment.controller.ts`

**Interfaces:**
- Consumes: The four service default exports from Task 2 and `successResponse(res, data)`.
- Produces: Async controller operations for all eight endpoints, compatible with `asyncHandler` from Task 1.

- [x] **Step 1: Add the authentication controller**

Create `src/api/controllers/auth.controller.ts`:

```ts
import { Request, Response } from 'express';

import AuthService from '../services/auth.service.js';
import { successResponse } from '../routes/response.js';

const signUp = async (req: Request, res: Response) => {
  const { name, email, password } = req.body;
  const user = await AuthService.signUp({ name, email, password });

  return successResponse(res, { user });
};

const login = async (req: Request, res: Response) => {
  const token = await AuthService.login(req.body);

  return successResponse(res, { token });
};

export default {
  signUp,
  login,
};
```

- [x] **Step 2: Add the user controller**

Create `src/api/controllers/user.controller.ts`:

```ts
import { Request, Response } from 'express';

import UserService from '../services/user.service.js';
import { successResponse } from '../routes/response.js';

const getOne = async (req: Request, res: Response) => {
  const { id } = req.params;
  const userId = id === 'me' ? req.userId! : Number(id);
  const user = await UserService.getOne(userId);

  return successResponse(res, { user });
};

const updateProfile = async (req: Request, res: Response) => {
  const { name, email, address } = req.body;
  const user = await UserService.update(req.userId!, { name, email, address });

  return successResponse(res, { user });
};

export default {
  getOne,
  updateProfile,
};
```

- [x] **Step 3: Add the post controller**

Create `src/api/controllers/post.controller.ts`:

```ts
import { Request, Response } from 'express';

import PostService from '../services/post.service.js';
import { successResponse } from '../routes/response.js';

const getUserPosts = async (req: Request, res: Response) => {
  const posts = await PostService.getUserPosts(req.userId!);

  return successResponse(res, { posts });
};

const createPost = async (req: Request, res: Response) => {
  const { title, content } = req.body;
  const post = await PostService.createPost(req.userId!, title, content);

  return successResponse(res, { post });
};

export default {
  getUserPosts,
  createPost,
};
```

- [x] **Step 4: Add the comment controller**

Create `src/api/controllers/comment.controller.ts`:

```ts
import { Request, Response } from 'express';

import CommentService from '../services/comment.service.js';
import { successResponse } from '../routes/response.js';

const getUserComments = async (req: Request, res: Response) => {
  const comments = await CommentService.getUserComments(req.userId!);

  return successResponse(res, { comments });
};

const createComment = async (req: Request, res: Response) => {
  const { content, postId } = req.body;
  const comment = await CommentService.createComment(
    req.userId!,
    postId,
    content
  );

  return successResponse(res, { comment });
};

export default {
  getUserComments,
  createComment,
};
```

- [x] **Step 5: Verify controllers compile and respect the repository boundary**

Run: `yarn build`

Expected: exit code `0` with no TypeScript errors.

Run: `rg -n "repositories|generated/prisma|PrismaClient" src/api/controllers`

Expected: no output and exit code `1`, proving controllers do not access repositories or Prisma.

- [x] **Step 6: Commit the controllers**

```bash
git add src/api/controllers/auth.controller.ts src/api/controllers/user.controller.ts src/api/controllers/post.controller.ts src/api/controllers/comment.controller.ts
git commit -m "refactor: add API controllers"
```

### Task 4: Make all route files declarative

**Files:**
- Modify: `src/api/routes/auth.router.ts`
- Modify: `src/api/routes/user.router.ts`
- Modify: `src/api/routes/post.router.ts`
- Modify: `src/api/routes/comment.router.ts`

**Interfaces:**
- Consumes: Controllers from Task 3; `asyncHandler`, `validateBody`, and `validateParams` from Task 1; existing `auth` and Joi schemas.
- Produces: Eight routes containing only path declarations and middleware/controller composition.

- [x] **Step 1: Refactor authentication routes**

Replace `src/api/routes/auth.router.ts` with:

```ts
import { Router } from 'express';

import AuthController from '../controllers/auth.controller.js';
import { asyncHandler } from '../middlewares/async-handler.middleware.js';
import { validateBody } from '../middlewares/validation.middleware.js';
import { loginSchema, signUpSchema } from './validators/auth.validator.js';

const router = Router();

router.post(
  '/sign-up',
  validateBody(signUpSchema),
  asyncHandler(AuthController.signUp)
);

router.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(AuthController.login)
);

export default router;
```

- [x] **Step 2: Refactor user routes**

Replace `src/api/routes/user.router.ts` with:

```ts
import { Router } from 'express';

import UserController from '../controllers/user.controller.js';
import { auth } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../middlewares/async-handler.middleware.js';
import {
  validateBody,
  validateParams,
} from '../middlewares/validation.middleware.js';
import {
  updateProfileSchema,
  userIdParamsSchema,
} from './validators/user.validator.js';

const router = Router();

router.get(
  '/:id',
  auth,
  validateParams(userIdParamsSchema),
  asyncHandler(UserController.getOne)
);

router.put(
  '/profile',
  auth,
  validateBody(updateProfileSchema),
  asyncHandler(UserController.updateProfile)
);

export default router;
```

- [x] **Step 3: Refactor post routes**

Replace `src/api/routes/post.router.ts` with:

```ts
import { Router } from 'express';

import PostController from '../controllers/post.controller.js';
import { auth } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../middlewares/async-handler.middleware.js';
import { validateBody } from '../middlewares/validation.middleware.js';
import { createPostSchema } from './validators/post.validator.js';

const router = Router();

router.get('/', auth, asyncHandler(PostController.getUserPosts));

router.post(
  '/',
  auth,
  validateBody(createPostSchema),
  asyncHandler(PostController.createPost)
);

export default router;
```

- [x] **Step 4: Refactor comment routes**

Replace `src/api/routes/comment.router.ts` with:

```ts
import { Router } from 'express';

import CommentController from '../controllers/comment.controller.js';
import { auth } from '../middlewares/auth.middleware.js';
import { asyncHandler } from '../middlewares/async-handler.middleware.js';
import { validateBody } from '../middlewares/validation.middleware.js';
import { createCommentSchema } from './validators/comment.validator.js';

const router = Router();

router.get('/', auth, asyncHandler(CommentController.getUserComments));

router.post(
  '/',
  auth,
  validateBody(createCommentSchema),
  asyncHandler(CommentController.createComment)
);

export default router;
```

- [x] **Step 5: Verify routes compile and contain only pipeline composition**

Run: `yarn build`

Expected: exit code `0` with no TypeScript errors.

Run: `rg -n "Handler|Service|successResponse|validateAsync|try[[:space:]]*\\{" src/api/routes/*.router.ts`

Expected: no output and exit code `1`.

Run: `rg -n "asyncHandler" src/api/routes/*.router.ts`

Expected: four route files and eight controller bindings are reported.

- [x] **Step 6: Commit the declarative routes**

```bash
git add src/api/routes/auth.router.ts src/api/routes/user.router.ts src/api/routes/post.router.ts src/api/routes/comment.router.ts
git commit -m "refactor: compose routes from middleware and controllers"
```

### Task 5: Remove obsolete handlers and run the completion audit

**Files:**
- Delete: `src/api/handlers/auth.handler.ts`
- Delete: `src/api/handlers/user.handler.ts`
- Delete: `src/api/handlers/post.handler.ts`
- Delete: `src/api/handlers/comment.handler.ts`

**Interfaces:**
- Consumes: The completed route, controller, service, middleware, and repository layers.
- Produces: A source tree with one implementation of each business operation and no obsolete handler layer.

- [x] **Step 1: Delete all four obsolete handler files**

Delete these exact files with `apply_patch`:

```txt
src/api/handlers/auth.handler.ts
src/api/handlers/user.handler.ts
src/api/handlers/post.handler.ts
src/api/handlers/comment.handler.ts
```

- [x] **Step 2: Confirm no source import references the old layer**

Run: `rg -n "api/handlers|handlers/|Handler" src --glob '*.ts'`

Expected: no output and exit code `1`.

- [x] **Step 3: Audit dependency boundaries**

Run: `rg -n "repositories|generated/prisma|PrismaClient" src/api/controllers`

Expected: no output and exit code `1`.

Run: `rg -n "from 'express'|from \"express\"" src/api/services`

Expected: no output and exit code `1`.

Run: `rg -n "validateAsync|successResponse|Service|try[[:space:]]*\\{" src/api/routes/*.router.ts`

Expected: no output and exit code `1`.

Run: `rg -n "PrismaClient|generated/prisma" src/api src/prisma --glob '*.ts'`

Expected: Prisma access appears only in `src/prisma/repositories/*.repository.ts`; Prisma input types may also appear in `src/api/services/auth.service.ts`.

- [x] **Step 4: Audit all public route contracts**

Run: `rg -n "router\\.(get|post|put)" src/api/routes/{auth,user,post,comment}.router.ts`

Expected: eight declarations corresponding to sign-up, login, get user, update profile, list posts, create post, list comments, and create comment. Confirm their router mount prefixes remain unchanged in `src/api/routes/index.ts`.

- [x] **Step 5: Run full lint and TypeScript verification**

Run: `yarn lint`

Expected: exit code `0` with no ESLint errors.

Run: `yarn build`

Expected: exit code `0` with no TypeScript errors.

Run: `git diff --check`

Expected: exit code `0` with no whitespace errors.

- [x] **Step 6: Commit handler removal**

```bash
git add src/api/handlers/auth.handler.ts src/api/handlers/user.handler.ts src/api/handlers/post.handler.ts src/api/handlers/comment.handler.ts
git commit -m "refactor: remove obsolete handler layer"
```

- [x] **Step 7: Perform final requirement-by-requirement review**

Run: `git diff --check HEAD~5..HEAD`

Expected: exit code `0` with no whitespace errors across all five implementation commits.

Compare the current source tree with
`docs/superpowers/specs/2026-07-10-layered-request-flow-design.md` and confirm:

```txt
[x] All eight endpoints use asyncHandler-wrapped controllers.
[x] All request bodies and the user-ID path parameter validate before controllers.
[x] Controllers only translate HTTP input/output and call services.
[x] Services contain business logic and have no Express imports.
[x] Repositories remain the only direct Prisma query layer.
[x] Successful endpoint paths and response envelopes are unchanged.
[x] Validation errors are AppError instances with status 400.
[x] No obsolete handler files or imports remain.
[x] yarn lint and yarn build both exit successfully.
```
