import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

import { env } from '~/config/enviroment';

const ACCESS_TOKEN_EXPIRATION = '5s';
const REFRESH_TOKEN_EXPIRATION = '30d';

export const generateAccessToken = (userId: string): string => {
  return jwt.sign({ id: userId }, env.JWT_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRATION,
  });
};

export const generateRefreshToken = (userId: string): string => {
  return jwt.sign({ id: userId }, env.REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRATION,
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
