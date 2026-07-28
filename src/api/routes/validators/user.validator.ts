import Joi from 'joi';

export const userIdParamsSchema = Joi.object({
  id: Joi.string().pattern(/^(me|[1-9]\d*)$/).required(),
});

export const updateProfileSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  email: Joi.string().email().optional(),
  address: Joi.string().allow('').optional(),
}).min(1);
