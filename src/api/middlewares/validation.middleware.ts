import { NextFunction, RequestHandler } from 'express';
import Joi from 'joi';

import { AppError } from '../errors/app.error.js';

const forwardValidationError = (error: unknown, next: NextFunction) => {
  if (Joi.isError(error)) {
    next(new AppError(error.message, 400));
    return;
  }

  next(error);
};

export const validateBody = (schema: Joi.ObjectSchema): RequestHandler => {
  return async (req, _res, next) => {
    try {
      req.body = await schema.validateAsync(req.body, { abortEarly: false });
      next();
    } catch (error: unknown) {
      forwardValidationError(error, next);
    }
  };
};

export const validateParams = (schema: Joi.ObjectSchema): RequestHandler => {
  return async (req, _res, next) => {
    try {
      req.params = await schema.validateAsync(req.params, {
        abortEarly: false,
      });
      next();
    } catch (error: unknown) {
      forwardValidationError(error, next);
    }
  };
};
