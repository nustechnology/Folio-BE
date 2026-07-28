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
