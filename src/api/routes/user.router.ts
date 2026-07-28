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
