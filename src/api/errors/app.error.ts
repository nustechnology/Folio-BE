import { StatusCodes } from 'http-status-codes';

import type { ErrorCode } from '~/api/errors/error-codes';

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = StatusCodes.INTERNAL_SERVER_ERROR,
    public readonly code?: ErrorCode
  ) {
    super(message);
    this.name = 'AppError';
  }
}
