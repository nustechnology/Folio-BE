import Joi from 'joi';

export const createPostSchema = Joi.object({
  title: Joi.string().min(1).max(255).required(),
  content: Joi.string().allow('').optional(),
});
