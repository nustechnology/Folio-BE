import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

import logger from '../../config/logger.js';
import { requestContext } from '../../config/request-context.js';

const getRequestId = (req: Request) => {
  const requestId = req.header('x-request-id');
  return requestId && requestId.length <= 128 ? requestId : randomUUID();
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
        Number(process.hrtime.bigint() - startTime) / 1_000_000;

      logger.http('HTTP request completed', {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        userId: req.userId,
      });
    });

    next();
  });
};
