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
    .default(PAGINATION.DEFAULT_LIMIT)
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

export const updateSpaceSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(NAME.MIN_LENGTH)
    .max(NAME.MAX_LENGTH)
    .optional()
    .messages({
      'string.empty': 'Enter a space name',
      'string.min': 'Enter a space name'
    }),
  researchObjective: Joi.string()
    .trim()
    .max(OBJECTIVE_MAX_LENGTH)
    .allow('')
    .optional()
}).min(1);
