import { Router } from 'express';

import SpaceController from '~/api/controllers/space.controller';
import NoteRouter from '~/api/routes/note.router';
import { auth } from '~/api/middlewares/auth.middleware';
import { asyncHandler } from '~/api/middlewares/async-handler.middleware';
import {
  validateBody,
  validateQuery
} from '~/api/middlewares/validation.middleware';
import {
  createSpaceSchema,
  listSpacesQuerySchema
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

router.use('/:spaceId/notes', NoteRouter);

export default router;
