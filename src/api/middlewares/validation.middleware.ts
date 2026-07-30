import { NextFunction, RequestHandler } from 'express';
import Joi from 'joi';

import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';

const forwardValidationError = (error: unknown, next: NextFunction) => {
  if (Joi.isError(error)) {
    next(new AppError(error.message, StatusCodes.BAD_REQUEST));
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

export const validateQuery = (schema: Joi.ObjectSchema): RequestHandler => {
  return async (req, _res, next) => {
    try {
      req.query = await schema.validateAsync(req.query, {
        abortEarly: false,
      });
      next();
    } catch (error: unknown) {
      forwardValidationError(error, next);
    }
  };
};
