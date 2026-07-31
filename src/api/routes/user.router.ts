import { Router } from 'express';

import UserController from '~/api/controllers/user.controller';
import { auth } from '~/api/middlewares/auth.middleware';
import { asyncHandler } from '~/api/middlewares/async-handler.middleware';
import {
  validateBody,
  validateParams,
} from '~/api/middlewares/validation.middleware';
import {
  updateProfileSchema,
  userIdParamsSchema,
} from '~/api/routes/validators/user.validator';

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
