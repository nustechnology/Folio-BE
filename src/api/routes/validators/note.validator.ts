import Joi from 'joi';

import { NOTE, PAGINATION } from '~/api/utils/constants';
import { OriginType } from '~/generated/prisma/client';

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
  /* Members come from the enum so the accepted set cannot drift from the
     column's domain — see `NoteOriginFilter`. */
  origin: Joi.string()
    .valid('all', ...Object.values(OriginType))
    .default('all'),
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
    })
});

/**
 * Unlike create, a title sent here MUST NOT be blank. Create substitutes
 * "Untitled Note" because a note being born has no title to lose; a note that
 * already has one should not lose it to an accidental clear. `.min(1)` on the
 * object rejects an empty body, which would otherwise be a no-op write that
 * still re-stamped `updatedAt` and jumped the note to the top of the list.
 */
export const updateNoteSchema = Joi.object({
  title: Joi.string()
    .trim()
    .min(1)
    .max(NOTE.TITLE_MAX_LENGTH)
    .optional()
    .messages({
      'string.empty': 'Title cannot be empty',
      'string.min': 'Title cannot be empty',
      'string.max': `Title cannot exceed ${NOTE.TITLE_MAX_LENGTH} characters`
    }),
  content: Joi.string()
    .min(NOTE.CONTENT_MIN_LENGTH)
    .max(NOTE.CONTENT_HTML_MAX_LENGTH)
    .optional()
    .messages({
      'string.empty': 'Content cannot be empty',
      'string.min': 'Content cannot be empty',
      'string.max': 'Content exceeds the maximum allowed size'
    })
})
  .min(1)
  .messages({ 'object.min': 'Provide a title or content to update' });
