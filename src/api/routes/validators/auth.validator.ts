import Joi from 'joi';

import { PASSWORD_MIN_LENGTH } from '~/api/utils/constants';

export const signUpSchema = Joi.object({
  email: Joi.string().email().required()
    .messages({ 'string.email': 'Please enter a valid email address.' }),
  password: Joi.string().min(PASSWORD_MIN_LENGTH).required()
    .messages({ 'string.min': `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.` }),
  confirmPassword: Joi.string().valid(Joi.ref('password')).required()
    .messages({ 'any.only': 'Passwords do not match.' }),
});

export const loginSchema = Joi.object({
  email: Joi.string().email().required()
    .messages({ 'string.email': 'Please enter a valid email address.' }),
  password: Joi.string().min(PASSWORD_MIN_LENGTH).required()
    .messages({ 'string.min': `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.` }),
});

export const refreshSchema = Joi.object({
  refreshToken: Joi.string().required(),
});
