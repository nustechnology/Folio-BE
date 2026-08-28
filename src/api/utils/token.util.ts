import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

import { env } from '~/config/enviroment';
import { BCRYPT_SALT_ROUNDS } from '~/api/utils/constants';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  tokenVersion: number;
  typ: 'access';
  iat: number;
  exp: number;
}

export interface RefreshTokenPayload {
  sub: string;
  email: string;
  tokenVersion: number;
  typ: 'refresh';
  iat: number;
  exp: number;
}

const TOKEN_CONFIG: jwt.SignOptions = {
  algorithm: 'HS256',
  issuer: 'folio-api-auth',
  audience: 'folio-web'
};

export const generateAccessToken = (
  userId: string,
  email: string,
  tokenVersion: number
): string => {
  return jwt.sign(
    { sub: userId, email, tokenVersion, typ: 'access' },
    env.JWT_TOKEN_SECRET,
    {
      ...TOKEN_CONFIG,
      expiresIn: env.ACCESS_TOKEN_EXPIRATION as string &
        jwt.SignOptions['expiresIn']
    }
  );
};

export const generateRefreshToken = (
  userId: string,
  email: string,
  tokenVersion: number
): string => {
  return jwt.sign(
    { sub: userId, email, tokenVersion, typ: 'refresh' },
    env.REFRESH_TOKEN_SECRET,
    {
      ...TOKEN_CONFIG,
      expiresIn: env.REFRESH_TOKEN_EXPIRATION as string &
        jwt.SignOptions['expiresIn']
    }
  );
};

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  return jwt.verify(token, env.JWT_TOKEN_SECRET) as AccessTokenPayload;
};

export const verifyRefreshToken = (token: string): RefreshTokenPayload => {
  return jwt.verify(token, env.REFRESH_TOKEN_SECRET) as RefreshTokenPayload;
};

export const hashToken = async (token: string): Promise<string> => {
  const salt = await bcrypt.genSalt(BCRYPT_SALT_ROUNDS);
  return bcrypt.hash(token, salt);
};

export interface FileAccessTokenPayload {
  sub: string;
  typ: 'file';
  iat: number;
  exp: number;
}

// Authorises the "Open original" link, which a new tab cannot put a bearer
// header on. Minted only after `getPreviewUrl` has checked ownership, and
// pinned to that one source, so a leaked link opens nothing once it expires.
const FILE_ACCESS_TOKEN_EXPIRATION = '5m';

export const generateFileAccessToken = (sourceId: string): string => {
  return jwt.sign({ sub: sourceId, typ: 'file' }, env.JWT_TOKEN_SECRET, {
    ...TOKEN_CONFIG,
    expiresIn: FILE_ACCESS_TOKEN_EXPIRATION
  });
};

// `typ` is checked because access tokens share this secret, issuer and
// audience — without it any bearer token would open any source id.
export const verifyFileAccessToken = (
  token: string
): FileAccessTokenPayload => {
  const payload = jwt.verify(
    token,
    env.JWT_TOKEN_SECRET
  ) as FileAccessTokenPayload;
  if (payload.typ !== 'file') {
    throw new jwt.JsonWebTokenError('Not a file access token');
  }
  return payload;
};
