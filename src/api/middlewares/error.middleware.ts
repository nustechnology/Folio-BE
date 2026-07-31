import { ErrorRequestHandler } from 'express';

import logger from '~/config/logger';
import { env } from '~/config/enviroment';
import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';
import { SERVER_ERROR_THRESHOLD } from '~/api/utils/constants';

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const normalizedError =
    error instanceof Error ? error : new Error(String(error));
  const isAppError = normalizedError instanceof AppError;
  const statusCode = isAppError ? normalizedError.statusCode : StatusCodes.INTERNAL_SERVER_ERROR;
  const logLevel = statusCode >= SERVER_ERROR_THRESHOLD ? 'error' : 'warn';
  const responseMessage =
    env.NODE_ENV === 'production' && statusCode >= SERVER_ERROR_THRESHOLD
      ? 'Internal server error'
      : normalizedError.message;

  logger.log(logLevel, normalizedError.message, {
    stack: normalizedError.stack,
    method: req.method,
    path: req.path,
    statusCode,
    userId: req.userId,
  });

  res.status(statusCode).json({
    status: 'error',
    message: responseMessage,
    ...(isAppError && normalizedError.code && { code: normalizedError.code }),
    ...(env.NODE_ENV !== 'production' && { stack: normalizedError.stack }),
  });
};
