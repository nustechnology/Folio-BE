import Joi from 'joi';

import { NAME, OBJECTIVE_MAX_LENGTH, PAGINATION } from '~/api/utils/constants';

export const spaceIdParamSchema = Joi.object({
  spaceId: Joi.string().uuid().required()
});

export const listSpacesQuerySchema = Joi.object({
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
    .default(PAGINATION.DEFAULT_LIMIT),
  // Archived spaces are hidden from the grid by default. Without this flag an
  // archived space would be unreachable from the list, and so impossible to
  // restore.
  archived: Joi.boolean().default(false)
});

export const createSpaceSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(NAME.MIN_LENGTH)
    .max(NAME.MAX_LENGTH)
    .required()
    .messages({
      'string.empty': 'Enter a space name',
      'string.min': 'Enter a space name',
      'any.required': 'Enter a space name'
    }),
  researchObjective: Joi.string()
    .trim()
    .max(OBJECTIVE_MAX_LENGTH)
    .allow('')
    .optional()
});

/**
 * Every field optional, but `.min(1)` on the object: an empty body is a
 * no-op the client did not mean to send, so it is a 400 rather than a silent
 * 200 (same rule as `updateNoteSchema`).
 *
 * `researchObjective` allows `''` deliberately — clearing the objective is a
 * real edit — while `name` does not: a space always has a name.
 */
export const updateSpaceSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(NAME.MIN_LENGTH)
    .max(NAME.MAX_LENGTH)
    .optional()
    .messages({
      'string.empty': 'Enter a space name',
      'string.min': 'Enter a space name',
      'string.max': `Name cannot exceed ${NAME.MAX_LENGTH} characters`
    }),
  researchObjective: Joi.string()
    .trim()
    .max(OBJECTIVE_MAX_LENGTH)
    .allow('')
    .optional(),
  isArchived: Joi.boolean().optional()
})
  .min(1)
  .messages({ 'object.min': 'Provide a field to update' });
