import { Router } from 'express';

import AskController from '~/api/controllers/ask.controller';
import { auth } from '~/api/middlewares/auth.middleware';
import { asyncHandler } from '~/api/middlewares/async-handler.middleware';
import {
  validateBody,
  validateParams,
  validateQuery
} from '~/api/middlewares/validation.middleware';
import {
  askSchema,
  spaceIdParamSchema,
  suggestionsQuerySchema
} from '~/api/routes/validators/ask.validator';

/** Mounted under `/spaces/:spaceId/ask`, so `spaceId` comes from the parent. */
const router = Router({ mergeParams: true });

router.get(
  '/suggestions',
  auth,
  validateParams(spaceIdParamSchema),
  validateQuery(suggestionsQuerySchema),
  asyncHandler(AskController.suggestions)
);

router.post(
  '/',
  auth,
  validateParams(spaceIdParamSchema),
  validateBody(askSchema),
  asyncHandler(AskController.ask)
);

export default router;
