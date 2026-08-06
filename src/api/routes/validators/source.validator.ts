import Joi from 'joi';

import {
  SOURCE_AUTHOR_MAX_LENGTH,
  SOURCE_CONTENT_MAX_LENGTH,
  SOURCE_CONTENT_MIN_LENGTH,
  SOURCE_TITLE_MAX_LENGTH,
  SOURCE_URL_MAX_LENGTH
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
    .default('recently-added')
});
