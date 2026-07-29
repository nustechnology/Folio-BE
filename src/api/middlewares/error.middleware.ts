import { ErrorRequestHandler } from 'express';

import logger from '~/config/logger';
import { env } from '~/config/enviroment';
import { AppError } from '~/api/errors/app.error';

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const normalizedError =
    error instanceof Error ? error : new Error(String(error));
  const statusCode =
    normalizedError instanceof AppError ? normalizedError.statusCode : 500;
  const logLevel = statusCode >= 500 ? 'error' : 'warn';
  const responseMessage =
    env.NODE_ENV === 'production' && statusCode >= 500
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
    ...(env.NODE_ENV !== 'production' && { stack: normalizedError.stack }),
  });
};
