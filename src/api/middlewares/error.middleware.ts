import { ErrorRequestHandler } from 'express';

import logger from '~/config/logger';
import { env } from '~/config/enviroment';
import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import {
  HTTP_STATUS_MAX,
  HTTP_STATUS_MIN,
  SERVER_ERROR_THRESHOLD
} from '~/api/utils/constants';

/**
 * body-parser rejects a body before any route runs, so its failures arrive
 * here as bare `http-errors` instances rather than `AppError`s. They are
 * recognised by `.type`, body-parser's own discriminator — deliberately not
 * `.code`, which Prisma (`P2002`), multer (`LIMIT_FILE_SIZE`) and Node syscall
 * errors (`ENOENT`) each use for something incompatible with the closed
 * `ErrorCode` union clients switch on.
 *
 * The message is replaced rather than forwarded: body-parser's own wording is
 * internals, and these statuses sit below `SERVER_ERROR_THRESHOLD`, so the
 * production guard below would hand it to the client unaltered.
 */
const TRANSPORT_ERRORS: Record<string, { code: ErrorCode; message: string }> = {
  'entity.too.large': {
    code: ErrorCode.PAYLOAD_TOO_LARGE,
    message: 'Request body is too large.'
  },
  'entity.parse.failed': {
    code: ErrorCode.MALFORMED_JSON,
    message: 'Request body is not valid JSON.'
  }
};

const describeTransportError = (error: Error) => {
  const { type } = error as Partial<{ type: unknown }>;
  return typeof type === 'string' ? TRANSPORT_ERRORS[type] : undefined;
};

/**
 * Trust a status an error brought with it, but only after proving it is one.
 * `http-errors` instances carry the status the client should actually see, and
 * collapsing them to `500` turns "your document is too large" into "the server
 * is broken". The value still comes from library code we do not own, so it is
 * range-checked: anything that is not an integer in the client/server error
 * range falls back to `500` rather than being allowed to pick the response.
 */
const readHttpStatus = (error: Error): number | undefined => {
  const candidate = error as Partial<{ status: unknown; statusCode: unknown }>;

  for (const value of [candidate.status, candidate.statusCode]) {
    if (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= HTTP_STATUS_MIN &&
      value <= HTTP_STATUS_MAX
    ) {
      return value;
    }
  }

  return undefined;
};

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const normalizedError =
    error instanceof Error ? error : new Error(String(error));
  const isAppError = normalizedError instanceof AppError;
  const transport = isAppError
    ? undefined
    : describeTransportError(normalizedError);

  const statusCode = isAppError
    ? normalizedError.statusCode
    : (readHttpStatus(normalizedError) ?? StatusCodes.INTERNAL_SERVER_ERROR);
  const errorCode = isAppError ? normalizedError.code : transport?.code;

  const logLevel = statusCode >= SERVER_ERROR_THRESHOLD ? 'error' : 'warn';

  /* The client gets the friendly wording, the log keeps the library's own —
     two variables on purpose, so a failure stays diagnosable from the logs. */
  const clientMessage = transport?.message ?? normalizedError.message;
  const responseMessage =
    env.NODE_ENV === 'production' && statusCode >= SERVER_ERROR_THRESHOLD
      ? 'Internal server error'
      : clientMessage;

  logger.log(logLevel, normalizedError.message, {
    stack: normalizedError.stack,
    method: req.method,
    path: req.path,
    statusCode,
    userId: req.userId
  });

  res.status(statusCode).json({
    status: 'error',
    message: responseMessage,
    ...(errorCode && { code: errorCode })
  });
};
