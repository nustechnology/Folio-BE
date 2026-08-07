import Joi from 'joi';

import { NOTE, PAGINATION } from '~/api/utils/constants';

export const spaceIdParamSchema = Joi.object({
  spaceId: Joi.string().uuid().required()
});

export const noteParamsSchema = Joi.object({
  spaceId: Joi.string().uuid().required(),
  noteId: Joi.string().uuid().required()
});

export const listNotesQuerySchema = Joi.object({
  search: Joi.string().allow('').optional(),
  sort: Joi.string()
    .valid(
      'recently-updated',
      'recently-created',
      'alphabetical-az',
      'alphabetical-za'
    )
    .default('recently-updated'),
  page: Joi.number().integer().min(1).default(PAGINATION.DEFAULT_PAGE),
  limit: Joi.number()
    .integer()
    .min(1)
    .max(PAGINATION.MAX_LIMIT)
    .default(PAGINATION.DEFAULT_LIMIT)
});

/**
 * An empty or whitespace-only title is accepted on purpose — the service
 * substitutes the default title. Only exceeding the limit is an error.
 */
export const createNoteSchema = Joi.object({
  title: Joi.string()
    .trim()
    .allow('')
    .max(NOTE.TITLE_MAX_LENGTH)
    .optional()
    .messages({
      'string.max': `Title cannot exceed ${NOTE.TITLE_MAX_LENGTH} characters`
    }),
  content: Joi.string()
    .min(NOTE.CONTENT_MIN_LENGTH)
    .max(NOTE.CONTENT_HTML_MAX_LENGTH)
    .required()
    .messages({
      'string.empty': 'Content cannot be empty',
      'string.min': 'Content cannot be empty',
      'any.required': 'Content cannot be empty',
      'string.max': 'Content exceeds the maximum allowed size'
    }),
  /** Set when saving a chat answer; both ids are needed to resolve it. */
  origin: Joi.object({
    conversationId: Joi.string().uuid().required(),
    messageId: Joi.string().uuid().required()
  }).optional()
});
