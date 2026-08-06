import { Router } from 'express';

import SpaceController from '~/api/controllers/space.controller';
import NoteRouter from '~/api/routes/note.router';
import NotebookRouter from '~/api/routes/notebook.router';
import { auth } from '~/api/middlewares/auth.middleware';
import { asyncHandler } from '~/api/middlewares/async-handler.middleware';
import {
  validateBody,
  validateParams,
  validateQuery
} from '~/api/middlewares/validation.middleware';
import { spaceIdParamSchema } from '~/api/routes/validators/common.validator';
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

router.get(
  '/:spaceId',
  auth,
  validateParams(spaceIdParamSchema),
  asyncHandler(SpaceController.get)
);

router.use('/:spaceId/notes', NoteRouter);
router.use('/:spaceId/notebook', NotebookRouter);

export default router;
