import { Router } from 'express';

import SpaceController from '~/api/controllers/space.controller';
import AskRouter from '~/api/routes/ask.router';
import ConversationRouter from '~/api/routes/conversation.router';
import NoteRouter from '~/api/routes/note.router';
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
  spaceIdParamSchema
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
  asyncHandler(SpaceController.getById)
);

router.use('/:spaceId/notes', NoteRouter);
router.use('/:spaceId/ask', AskRouter);
router.use('/:spaceId/conversations', ConversationRouter);

export default router;
