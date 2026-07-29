import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { env } from '~/config/enviroment';
import { AppError } from '~/api/errors/app.error';

interface MJwtPayload {
  id: string;
  iat: number;
  exp: number;
}

export const auth = (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      next(new AppError('Invalid token', 401, 'TOKEN_MISSING'));
      return;
    }

    const payload = jwt.verify(token, env.JWT_TOKEN_SECRET) as MJwtPayload;
    req.userId = payload.id;

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new AppError('Access token expired', 401, 'TOKEN_EXPIRED'));
      return;
    }
    next(new AppError('Invalid token', 401, 'TOKEN_INVALID'));
  }
}

export default {
  auth
}
