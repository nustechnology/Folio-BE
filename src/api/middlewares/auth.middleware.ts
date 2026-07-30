import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import UserRepository from '~/prisma/repositories/user.repository';
import { verifyAccessToken } from '~/api/utils/token.util';

export const auth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      next(new AppError('Authorization token is required', StatusCodes.UNAUTHORIZED, ErrorCode.TOKEN_MISSING));
      return;
    }

    const payload = verifyAccessToken(token);

    const user = await UserRepository.findById(payload.sub);
    if (!user || user.tokenVersion !== payload.tokenVersion) {
      next(new AppError('Token has been revoked. Please log in again.', StatusCodes.UNAUTHORIZED, ErrorCode.TOKEN_REVOKED));
      return;
    }

    req.userId = payload.sub;

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new AppError('Access token has expired', StatusCodes.UNAUTHORIZED, ErrorCode.TOKEN_EXPIRED));
      return;
    }
    next(new AppError('Authorization token is invalid or malformed', StatusCodes.UNAUTHORIZED, ErrorCode.TOKEN_INVALID));
  }
}

export default {
  auth
}
