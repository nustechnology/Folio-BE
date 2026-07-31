import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

import { env } from "~/config/enviroment";
import { BCRYPT_SALT_ROUNDS } from "~/api/utils/constants";

export interface AccessTokenPayload {
  sub: string;
  email: string;
  tokenVersion: number;
  typ: "access";
  iat: number;
  exp: number;
}

export interface RefreshTokenPayload {
  sub: string;
  email: string;
  tokenVersion: number;
  typ: "refresh";
  iat: number;
  exp: number;
}

const TOKEN_CONFIG: jwt.SignOptions = {
  algorithm: "HS256",
  issuer: "folio-api-auth",
  audience: "folio-web",
};

export const generateAccessToken = (userId: string, email: string, tokenVersion: number): string => {
  return jwt.sign(
    { sub: userId, email, tokenVersion, typ: "access" },
    env.JWT_TOKEN_SECRET,
    {
      ...TOKEN_CONFIG,
      expiresIn: env.ACCESS_TOKEN_EXPIRATION as string &
        jwt.SignOptions["expiresIn"],
    },
  );
};

export const generateRefreshToken = (userId: string, email: string, tokenVersion: number): string => {
  return jwt.sign(
    { sub: userId, email, tokenVersion, typ: "refresh" },
    env.REFRESH_TOKEN_SECRET,
    {
      ...TOKEN_CONFIG,
      expiresIn: env.REFRESH_TOKEN_EXPIRATION as string &
        jwt.SignOptions["expiresIn"],
    },
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
