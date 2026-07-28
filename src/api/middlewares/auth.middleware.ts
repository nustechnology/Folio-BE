import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

import { env } from '../../config/enviroment.js';
import { AppError } from '../errors/app.error.js';

interface MJwtPayload {
  id: number;
  iat: number;
  exp: number;
}

export const auth = (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      next(new AppError('Invalid token', 401));
      return;
    }

    const payload = jwt.verify(token, env.JWT_TOKEN_SECRET) as MJwtPayload;
    req.userId = payload.id;

    next();
  } catch {
    next(new AppError('Invalid token', 401));
  }
}

export default {
  auth
}
