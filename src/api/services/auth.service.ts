import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { StatusCodes } from 'http-status-codes';

import UserRepository from '~/prisma/repositories/user.repository';
import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import { BCRYPT_SALT_ROUNDS } from '~/api/utils/constants';
import { exclude } from '~/api/utils/exclude';
import {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  verifyRefreshToken,
  type RefreshTokenPayload,
} from '~/api/utils/token.util';

const signUp = async (payload: { email: string; password: string }) => {
  const { email, password } = payload;

  let existingUser;
  try {
    existingUser = await UserRepository.findOneByEmail(email);
  } catch {
    throw new AppError('Something went wrong. Please try again.', StatusCodes.INTERNAL_SERVER_ERROR, ErrorCode.INTERNAL_ERROR);
  }
  if (existingUser) {
    throw new AppError('An account with this email already exists', StatusCodes.CONFLICT, ErrorCode.EMAIL_EXISTS);
  }

  const name = email.split('@')[0];

  const salt = await bcrypt.genSalt(BCRYPT_SALT_ROUNDS);
  const hashPassword = await bcrypt.hash(password, salt);

  let user;
  try {
    user = await UserRepository.create({
      name,
      email,
      password: hashPassword,
    });
  } catch {
    throw new AppError('An account with this email already exists', StatusCodes.CONFLICT, ErrorCode.EMAIL_EXISTS);
  }

  const accessToken = generateAccessToken(user.id, user.email, user.tokenVersion);
  const rawRefreshToken = generateRefreshToken(user.id, user.email, user.tokenVersion);
  const hashedRefreshToken = await hashToken(rawRefreshToken);

  try {
    await UserRepository.updateRefreshToken(user.id, hashedRefreshToken);
  } catch {
    throw new AppError('Failed to create session. Please try again.', StatusCodes.INTERNAL_SERVER_ERROR, ErrorCode.INTERNAL_ERROR);
  }

  return { user: exclude(user, ['refreshToken', 'tokenVersion']), accessToken, refreshToken: rawRefreshToken };
};

const login = async (payload: { email: string; password: string }) => {
  const { email, password } = payload;

  let user;
  try {
    user = await UserRepository.findOneByEmail(email);
  } catch {
    throw new AppError('Something went wrong. Please try again.', StatusCodes.INTERNAL_SERVER_ERROR, ErrorCode.INTERNAL_ERROR);
  }
  if (!user) {
    throw new AppError('Invalid email or password. Please try again.', StatusCodes.UNAUTHORIZED, ErrorCode.INVALID_CREDENTIALS);
  }

  const checkPassword = await bcrypt.compare(password, user.password);
  if (!checkPassword) {
    throw new AppError('Invalid email or password. Please try again.', StatusCodes.UNAUTHORIZED, ErrorCode.INVALID_CREDENTIALS);
  }

  const accessToken = generateAccessToken(user.id, user.email, user.tokenVersion);
  const rawRefreshToken = generateRefreshToken(user.id, user.email, user.tokenVersion);
  const hashedRefreshToken = await hashToken(rawRefreshToken);

  try {
    await UserRepository.updateRefreshToken(user.id, hashedRefreshToken);
  } catch {
    throw new AppError('Failed to create session. Please try again.', StatusCodes.INTERNAL_SERVER_ERROR, ErrorCode.INTERNAL_ERROR);
  }

  return { accessToken, refreshToken: rawRefreshToken };
};

const refresh = async (payload: { refreshToken: string }) => {
  const { refreshToken: rawRefreshToken } = payload;

  let decoded: RefreshTokenPayload;
  try {
    decoded = verifyRefreshToken(rawRefreshToken);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError('Refresh token has expired. Please log in again.', StatusCodes.UNAUTHORIZED, ErrorCode.TOKEN_EXPIRED);
    }
    throw new AppError('Refresh token is invalid or malformed', StatusCodes.UNAUTHORIZED, ErrorCode.TOKEN_INVALID);
  }

  let user;
  try {
    user = await UserRepository.findById(decoded.sub);
  } catch {
    throw new AppError('Something went wrong. Please try again.', StatusCodes.INTERNAL_SERVER_ERROR, ErrorCode.INTERNAL_ERROR);
  }
  if (!user || !user.refreshToken) {
    throw new AppError('Refresh token is no longer valid. Please log in again.', StatusCodes.UNAUTHORIZED, ErrorCode.TOKEN_INVALID);
  }

  if (user.tokenVersion !== decoded.tokenVersion) {
    throw new AppError('Refresh token has been revoked. Please log in again.', StatusCodes.UNAUTHORIZED, ErrorCode.TOKEN_REVOKED);
  }

  const isTokenValid = await bcrypt.compare(rawRefreshToken, user.refreshToken);
  if (!isTokenValid) {
    throw new AppError('Refresh token has been revoked. Please log in again.', StatusCodes.UNAUTHORIZED, ErrorCode.TOKEN_INVALID);
  }

  const newAccessToken = generateAccessToken(user.id, user.email, user.tokenVersion);
  const newRawRefreshToken = generateRefreshToken(user.id, user.email, user.tokenVersion);
  const newHashedRefreshToken = await hashToken(newRawRefreshToken);

  try {
    await UserRepository.updateRefreshToken(user.id, newHashedRefreshToken);
  } catch {
    throw new AppError('Failed to refresh session. Please try again.', StatusCodes.INTERNAL_SERVER_ERROR, ErrorCode.INTERNAL_ERROR);
  }

  return { accessToken: newAccessToken, refreshToken: newRawRefreshToken };
};

const logout = async (userId: string) => {
  try {
    await UserRepository.updateRefreshToken(userId, null);
    await UserRepository.incrementTokenVersion(userId);
  } catch {
    throw new AppError('Failed to log out. Please try again.', StatusCodes.INTERNAL_SERVER_ERROR, ErrorCode.INTERNAL_ERROR);
  }
};

export default {
  signUp,
  login,
  refresh,
  logout,
};
