import { Router } from 'express';

import SpaceController from '~/api/controllers/space.controller';
import { auth } from '~/api/middlewares/auth.middleware';
import { asyncHandler } from '~/api/middlewares/async-handler.middleware';
import { validateQuery } from '~/api/middlewares/validation.middleware';
import { listSpacesQuerySchema } from '~/api/routes/validators/space.validator';

const router = Router();

router.get(
  '/',
  auth,
  validateQuery(listSpacesQuerySchema),
  asyncHandler(SpaceController.list)
);

export default router;
