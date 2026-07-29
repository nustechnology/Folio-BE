import Joi from 'joi';

export const signUpSchema = Joi.object({
  email: Joi.string().email().required()
    .messages({ 'string.email': 'Please enter a valid email address.' }),
  password: Joi.string().min(4).required()
    .messages({ 'string.min': 'Password must be at least 4 characters long.' }),
  confirmPassword: Joi.string().valid(Joi.ref('password')).required()
    .messages({ 'any.only': 'Passwords do not match.' }),
});

export const loginSchema = Joi.object({
  email: Joi.string().email().required()
    .messages({ 'string.email': 'Please enter a valid email address.' }),
  password: Joi.string().min(4).required()
    .messages({ 'string.min': 'Password must be at least 4 characters long.' }),
});

export const refreshSchema = Joi.object({
  refreshToken: Joi.string().required(),
});
