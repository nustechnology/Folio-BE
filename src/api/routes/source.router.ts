import { Router } from 'express';

import SourceController from '~/api/controllers/source.controller';
import { auth } from '~/api/middlewares/auth.middleware';
import { asyncHandler } from '~/api/middlewares/async-handler.middleware';
import { uploadSingleFile } from '~/api/middlewares/upload.middleware';
import {
  validateBody,
  validateParams,
  validateQuery
} from '~/api/middlewares/validation.middleware';
import { sourceIdParamSchema } from '~/api/routes/validators/common.validator';
import {
  listSourcesQuerySchema,
  sourceMediaParamSchema,
  updateSourceSchema
} from '~/api/routes/validators/source.validator';

const router = Router();

router.post('/', auth, uploadSingleFile, asyncHandler(SourceController.create));

router.get(
  '/',
  auth,
  validateQuery(listSourcesQuerySchema),
  asyncHandler(SourceController.list)
);

router.get('/status', auth, asyncHandler(SourceController.status));

router.get(
  '/:sourceId',
  auth,
  validateParams(sourceIdParamSchema),
  asyncHandler(SourceController.getById)
);

router.patch(
  '/:sourceId',
  auth,
  validateParams(sourceIdParamSchema),
  validateBody(updateSourceSchema),
  asyncHandler(SourceController.update)
);

router.get(
  '/:sourceId/preview',
  auth,
  validateParams(sourceIdParamSchema),
  asyncHandler(SourceController.getPreviewUrl)
);

// Deliberately not behind `auth`: see SourceController.getMedia.
router.get(
  '/:sourceId/media/:fileName',
  validateParams(sourceMediaParamSchema),
  asyncHandler(SourceController.getMedia)
);

router.delete(
  '/:sourceId',
  auth,
  validateParams(sourceIdParamSchema),
  asyncHandler(SourceController.remove)
);

router.post(
  '/:sourceId/retry',
  auth,
  validateParams(sourceIdParamSchema),
  asyncHandler(SourceController.retry)
);

export default router;
