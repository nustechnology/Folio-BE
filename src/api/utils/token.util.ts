import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

import { env } from '~/config/enviroment';

export const generateAccessToken = (userId: string): string => {
  return jwt.sign({ id: userId }, env.JWT_TOKEN_SECRET, {
    expiresIn: env.ACCESS_TOKEN_EXPIRATION as string & jwt.SignOptions['expiresIn'],
  });
};

export const generateRefreshToken = (userId: string): string => {
  return jwt.sign({ id: userId }, env.REFRESH_TOKEN_SECRET, {
    expiresIn: env.REFRESH_TOKEN_EXPIRATION as string & jwt.SignOptions['expiresIn'],
  });
};

export const verifyAccessToken = (token: string): { id: string } => {
  return jwt.verify(token, env.JWT_TOKEN_SECRET) as { id: string };
};

export const verifyRefreshToken = (token: string): { id: string } => {
  return jwt.verify(token, env.REFRESH_TOKEN_SECRET) as { id: string };
};

export const hashToken = async (token: string): Promise<string> => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(token, salt);
};
