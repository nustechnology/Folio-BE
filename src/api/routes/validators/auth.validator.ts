import Joi from 'joi';

import {
  NAME,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  REFRESH_TOKEN_MAX_LENGTH
} from '~/api/utils/constants';

export const signUpSchema = Joi.object({
  name: Joi.string()
    .min(NAME.MIN_LENGTH)
    .max(NAME.MAX_LENGTH)
    .required()
    .messages({
      'string.min': `Name must be at least ${NAME.MIN_LENGTH} character long.`,
      'string.max': `Name must be at most ${NAME.MAX_LENGTH} characters long.`
    }),
  email: Joi.string()
    .email()
    .required()
    .messages({ 'string.email': 'Please enter a valid email address.' }),
  password: Joi.string()
    .min(PASSWORD_MIN_LENGTH)
    .max(PASSWORD_MAX_LENGTH)
    .required()
    .messages({
      'string.min': `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`,
      'string.max': `Password must be at most ${PASSWORD_MAX_LENGTH} characters long.`
    }),
  confirmPassword: Joi.string()
    .valid(Joi.ref('password'))
    .required()
    .messages({ 'any.only': 'Passwords do not match.' })
});

export const loginSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .messages({ 'string.email': 'Please enter a valid email address.' }),
  password: Joi.string()
    .min(PASSWORD_MIN_LENGTH)
    .max(PASSWORD_MAX_LENGTH)
    .required()
    .messages({
      'string.min': `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`,
      'string.max': `Password must be at most ${PASSWORD_MAX_LENGTH} characters long.`
    })
});

export const refreshSchema = Joi.object({
  refreshToken: Joi.string().max(REFRESH_TOKEN_MAX_LENGTH).required()
});
