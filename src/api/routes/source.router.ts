import { Router } from 'express';

import SourceController from '~/api/controllers/source.controller';
import { auth } from '~/api/middlewares/auth.middleware';
import { asyncHandler } from '~/api/middlewares/async-handler.middleware';
import { uploadSingleFile } from '~/api/middlewares/upload.middleware';
import {
  validateParams,
  validateQuery
} from '~/api/middlewares/validation.middleware';
import {
  listSourcesQuerySchema,
  sourceIdParamSchema
} from '~/api/routes/validators/source.validator';

const router = Router();

router.post('/', auth, uploadSingleFile, asyncHandler(SourceController.create));

router.get(
  '/',
  auth,
  validateQuery(listSourcesQuerySchema),
  asyncHandler(SourceController.list)
);

router.get(
  '/:sourceId',
  auth,
  validateParams(sourceIdParamSchema),
  asyncHandler(SourceController.getById)
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
