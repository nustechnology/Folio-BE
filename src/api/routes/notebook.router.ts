import { Router } from 'express';

import NotebookController from '~/api/controllers/notebook.controller';
import { auth } from '~/api/middlewares/auth.middleware';
import { asyncHandler } from '~/api/middlewares/async-handler.middleware';
import {
  validateBody,
  validateParams
} from '~/api/middlewares/validation.middleware';
import { spaceIdParamSchema } from '~/api/routes/validators/common.validator';
import { saveNotebookSchema } from '~/api/routes/validators/notebook.validator';

/** Mounted under `/spaces/:spaceId/notebook`, so `spaceId` comes from the parent. */
const router = Router({ mergeParams: true });

router.get(
  '/',
  auth,
  validateParams(spaceIdParamSchema),
  asyncHandler(NotebookController.get)
);

/**
 * `PUT`, not `PATCH`: auto-save sends the entire document, so the request is a
 * whole-resource replacement and repeating it is a no-op — which matters when
 * a debounced save and a flush-on-exit both carry the same payload.
 */
router.put(
  '/',
  auth,
  validateParams(spaceIdParamSchema),
  validateBody(saveNotebookSchema),
  asyncHandler(NotebookController.save)
);

export default router;
