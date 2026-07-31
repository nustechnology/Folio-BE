import Joi from 'joi';

import { NAME } from '~/api/utils/constants';

export const userIdParamsSchema = Joi.object({
  id: Joi.string().required(),
});

export const updateProfileSchema = Joi.object({
  name: Joi.string().min(NAME.MIN_LENGTH).max(NAME.MAX_LENGTH).optional(),
  email: Joi.string().email().optional(),
  address: Joi.string().allow('').optional(),
}).min(1);
