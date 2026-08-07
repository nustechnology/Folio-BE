import Joi from 'joi';

import { ASK } from '~/api/utils/constants';

export const spaceIdParamSchema = Joi.object({
  spaceId: Joi.string().uuid().required()
});

export const conversationParamsSchema = Joi.object({
  spaceId: Joi.string().uuid().required(),
  conversationId: Joi.string().uuid().required()
});

export const messageParamsSchema = Joi.object({
  spaceId: Joi.string().uuid().required(),
  conversationId: Joi.string().uuid().required(),
  messageId: Joi.string().uuid().required()
});

/** `sourceId` is required by the `source` scope and rejected by `space`. */
export const askSchema = Joi.object({
  question: Joi.string()
    .trim()
    .min(ASK.QUESTION_MIN_LENGTH)
    .max(ASK.QUESTION_MAX_LENGTH)
    .required()
    .messages({
      'string.empty': 'A question is required',
      'any.required': 'A question is required',
      'string.max': `A question cannot exceed ${ASK.QUESTION_MAX_LENGTH} characters`
    }),
  scope: Joi.string().valid('space', 'source').default('space'),
  sourceId: Joi.string().uuid().when('scope', {
    is: 'source',
    then: Joi.required(),
    otherwise: Joi.forbidden()
  }),
  conversationId: Joi.string().uuid().optional()
});

export const suggestionsQuerySchema = Joi.object({
  scope: Joi.string().valid('space', 'source').default('space'),
  sourceId: Joi.string().uuid().when('scope', {
    is: 'source',
    then: Joi.required(),
    otherwise: Joi.optional()
  })
});

export const feedbackSchema = Joi.object({
  rating: Joi.string().valid('useful', 'not_useful').required()
});
