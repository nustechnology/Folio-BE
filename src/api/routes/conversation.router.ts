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
  conversationParamsSchema,
  feedbackSchema,
  listConversationsQuerySchema,
  messageParamsSchema,
  renameConversationSchema,
  spaceIdParamSchema
} from '~/api/routes/validators/ask.validator';

/** Mounted under `/spaces/:spaceId/conversations`. */
const router = Router({ mergeParams: true });

router.get(
  '/',
  auth,
  validateParams(spaceIdParamSchema),
  validateQuery(listConversationsQuerySchema),
  asyncHandler(AskController.listConversations)
);

router.get(
  '/:conversationId',
  auth,
  validateParams(conversationParamsSchema),
  asyncHandler(AskController.getConversation)
);

router.patch(
  '/:conversationId',
  auth,
  validateParams(conversationParamsSchema),
  validateBody(renameConversationSchema),
  asyncHandler(AskController.renameConversation)
);

router.delete(
  '/:conversationId',
  auth,
  validateParams(conversationParamsSchema),
  asyncHandler(AskController.deleteConversation)
);

router.post(
  '/:conversationId/messages/:messageId/feedback',
  auth,
  validateParams(messageParamsSchema),
  validateBody(feedbackSchema),
  asyncHandler(AskController.recordFeedback)
);

export default router;
