import Joi from 'joi';

export const createCommentSchema = Joi.object({
  content: Joi.string().min(1).required(),
  postId: Joi.number().integer().positive().required(),
});
