import { Router } from 'express';

import AskController from '~/api/controllers/ask.controller';
import { auth } from '~/api/middlewares/auth.middleware';
import { asyncHandler } from '~/api/middlewares/async-handler.middleware';
import {
  validateBody,
  validateParams
} from '~/api/middlewares/validation.middleware';
import {
  conversationParamsSchema,
  feedbackSchema,
  messageParamsSchema
} from '~/api/routes/validators/ask.validator';

/** Mounted under `/spaces/:spaceId/conversations`. */
const router = Router({ mergeParams: true });

router.get(
  '/:conversationId',
  auth,
  validateParams(conversationParamsSchema),
  asyncHandler(AskController.getConversation)
);

router.post(
  '/:conversationId/messages/:messageId/feedback',
  auth,
  validateParams(messageParamsSchema),
  validateBody(feedbackSchema),
  asyncHandler(AskController.recordFeedback)
);

export default router;
