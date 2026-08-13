import Joi from 'joi';

import {
  SOURCE_AUTHOR_MAX_LENGTH,
  SOURCE_CONTENT_MAX_LENGTH,
  SOURCE_CONTENT_MIN_LENGTH,
  SOURCE_TITLE_MAX_LENGTH,
  SOURCE_URL_MAX_LENGTH,
  PAGINATION
} from '~/api/utils/constants';

const spaceIdField = () =>
  Joi.string().uuid().required().messages({
    'string.empty': 'Space is required',
    'any.required': 'Space is required',
    'string.guid': 'Invalid space'
  });

const sourceTypeField = (type: string) =>
  Joi.string().valid(type).required().messages({
    'any.required': 'Source type is required',
    'any.only': 'Invalid source type'
  });

const titleField = () =>
  Joi.string()
    .trim()
    .max(SOURCE_TITLE_MAX_LENGTH)
    .optional()
    .allow('')
    .messages({ 'string.max': 'Title is too long' });

const authorField = () =>
  Joi.string()
    .trim()
    .max(SOURCE_AUTHOR_MAX_LENGTH)
    .optional()
    .allow('')
    .messages({ 'string.max': 'Author is too long' });

export const sourceIdParamSchema = Joi.object({
  sourceId: Joi.string().uuid().required()
});

// Names are generated as `<32 hex chars>.<ext>`, so anything else — path
// traversal in particular — is rejected before the key is built.
export const sourceMediaParamSchema = Joi.object({
  sourceId: Joi.string().uuid().required(),
  fileName: Joi.string()
    .pattern(/^[0-9a-f]{32}\.[a-z0-9]{2,4}$/)
    .required()
});

export const createWebSourceSchema = Joi.object({
  spaceId: spaceIdField(),
  sourceType: sourceTypeField('Web'),
  sourceUrl: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .max(SOURCE_URL_MAX_LENGTH)
    .required()
    .messages({
      'string.uri': 'Please enter a valid URL',
      'string.uriCustomScheme': 'Please enter a valid URL',
      'any.required': 'Please enter a valid URL'
    }),
  title: titleField(),
  author: authorField()
});

export const createManualSourceSchema = Joi.object({
  spaceId: spaceIdField(),
  sourceType: sourceTypeField('Manual'),
  title: titleField(),
  author: authorField(),
  content: Joi.string()
    .trim()
    .min(SOURCE_CONTENT_MIN_LENGTH)
    .max(SOURCE_CONTENT_MAX_LENGTH)
    .required()
    .messages({
      'string.empty': 'Content must be at least 10 characters long.',
      'string.min': 'Content must be at least 10 characters long.',
      'any.required': 'Content must be at least 10 characters long.',
      'string.max': 'Content exceeds maximum limit of 50,000 characters.'
    })
});

export const createFileSourceSchema = Joi.object({
  spaceId: spaceIdField(),
  sourceType: sourceTypeField('File'),
  title: titleField(),
  author: authorField()
});

export const listSourcesQuerySchema = Joi.object({
  spaceId: Joi.string().uuid().required(),
  sourceType: Joi.string().valid('File', 'Web', 'Manual').optional(),
  processingState: Joi.string()
    .valid('added', 'extracting_text', 'indexing_evidence', 'ready', 'failed')
    .optional(),
  search: Joi.string().trim().max(255).allow('').optional(),
  sort: Joi.string()
    .valid('recently-added', 'alphabetical-az', 'alphabetical-za')
    .default('recently-added'),
  page: Joi.number().integer().min(1).default(PAGINATION.DEFAULT_PAGE),
  limit: Joi.number()
    .integer()
    .min(1)
    .max(PAGINATION.MAX_LIMIT)
    .default(PAGINATION.DEFAULT_LIMIT)
});

export const updateSourceSchema = Joi.object({
  title: Joi.string()
    .trim()
    .min(1)
    .max(SOURCE_TITLE_MAX_LENGTH)
    .required()
    .messages({
      'string.empty': 'Title is required',
      'string.max': 'Title must be at most 200 characters',
      'any.required': 'Title is required'
    }),
  author: Joi.string()
    .trim()
    .max(SOURCE_AUTHOR_MAX_LENGTH)
    .allow('', null)
    .optional()
    .messages({
      'string.max': 'Author name must be at most 100 characters'
    }),
  content: Joi.string()
    .trim()
    .min(SOURCE_CONTENT_MIN_LENGTH)
    .max(SOURCE_CONTENT_MAX_LENGTH)
    .optional()
    .messages({
      'string.min': 'Content must be at least 10 characters long.',
      'string.max': 'Content exceeds maximum limit of 50,000 characters.'
    })
});
