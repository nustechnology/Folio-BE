import { Router } from 'express';

import NoteController from '~/api/controllers/note.controller';
import { auth } from '~/api/middlewares/auth.middleware';
import { asyncHandler } from '~/api/middlewares/async-handler.middleware';
import {
  validateBody,
  validateParams,
  validateQuery
} from '~/api/middlewares/validation.middleware';
import {
  createNoteSchema,
  listNotesQuerySchema,
  noteParamsSchema,
  spaceIdParamSchema,
  updateNoteSchema
} from '~/api/routes/validators/note.validator';

/** Mounted under `/spaces/:spaceId/notes`, so `spaceId` comes from the parent. */
const router = Router({ mergeParams: true });

router.get(
  '/',
  auth,
  validateParams(spaceIdParamSchema),
  validateQuery(listNotesQuerySchema),
  asyncHandler(NoteController.list)
);

router.post(
  '/',
  auth,
  validateParams(spaceIdParamSchema),
  validateBody(createNoteSchema),
  asyncHandler(NoteController.create)
);

router.get(
  '/:noteId',
  auth,
  validateParams(noteParamsSchema),
  asyncHandler(NoteController.get)
);

router.patch(
  '/:noteId',
  auth,
  validateParams(noteParamsSchema),
  validateBody(updateNoteSchema),
  asyncHandler(NoteController.update)
);

router.delete(
  '/:noteId',
  auth,
  validateParams(noteParamsSchema),
  asyncHandler(NoteController.remove)
);

export default router;
