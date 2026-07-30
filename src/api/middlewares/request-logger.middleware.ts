import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

import logger from '~/config/logger';
import { requestContext } from '~/config/request-context';
import {
  REQUEST_ID_MAX_LENGTH,
  DURATION_DECIMAL_PRECISION,
  NANOSECONDS_PER_MILLISECOND
} from '~/api/utils/constants';

const getRequestId = (req: Request) => {
  const requestId = req.header('x-request-id');
  return requestId && requestId.length <= REQUEST_ID_MAX_LENGTH
    ? requestId
    : randomUUID();
};

export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = getRequestId(req);
  const startTime = process.hrtime.bigint();

  requestContext.run({ requestId }, () => {
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    res.on('finish', () => {
      const durationMs =
        Number(process.hrtime.bigint() - startTime) /
        NANOSECONDS_PER_MILLISECOND;

      logger.http('HTTP request completed', {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(DURATION_DECIMAL_PRECISION)),
        userId: req.userId
      });
    });

    next();
  });
};
