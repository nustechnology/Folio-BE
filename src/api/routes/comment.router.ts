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
