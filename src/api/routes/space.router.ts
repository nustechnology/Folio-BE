import { Router } from 'express';

import SpaceController from '~/api/controllers/space.controller';
import { auth } from '~/api/middlewares/auth.middleware';
import { asyncHandler } from '~/api/middlewares/async-handler.middleware';
import {
  validateBody,
  validateParams,
  validateQuery
} from '~/api/middlewares/validation.middleware';
import {
  createSpaceSchema,
  listSpacesQuerySchema,
  spaceIdParamsSchema,
  updateSpaceSchema
} from '~/api/routes/validators/space.validator';

const router = Router();

router.get(
  '/',
  auth,
  validateQuery(listSpacesQuerySchema),
  asyncHandler(SpaceController.list)
);

router.post(
  '/',
  auth,
  validateBody(createSpaceSchema),
  asyncHandler(SpaceController.create)
);

router.patch(
  '/:id',
  auth,
  validateParams(spaceIdParamsSchema),
  validateBody(updateSpaceSchema),
  asyncHandler(SpaceController.update)
);

router.delete(
  '/:id',
  auth,
  validateParams(spaceIdParamsSchema),
  asyncHandler(SpaceController.remove)
);

export default router;
