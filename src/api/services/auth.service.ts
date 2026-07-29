import bcrypt from 'bcryptjs';

import UserRepository from '~/prisma/repositories/user.repository';
import { AppError } from '~/api/errors/app.error';
import {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  verifyRefreshToken,
} from '~/api/utils/token.util';

const SALT_ROUND = 10;

const signUp = async (payload: { email: string; password: string }) => {
  const { email, password } = payload;

  const existingUser = await UserRepository.findOneByEmail(email);
  if (existingUser) {
    throw new AppError('An account with this email already exists', 409);
  }

  const name = email.split('@')[0];

  const salt = await bcrypt.genSalt(SALT_ROUND);
  const hashPassword = await bcrypt.hash(password, salt);

  const user = await UserRepository.create({
    name,
    email,
    password: hashPassword,
  });

  const accessToken = generateAccessToken(user.id);
  const rawRefreshToken = generateRefreshToken(user.id);
  const hashedRefreshToken = await hashToken(rawRefreshToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await UserRepository.updateRefreshToken(user.id, hashedRefreshToken, expiresAt);

  return { user, accessToken, refreshToken: rawRefreshToken };
};

const login = async (payload: { email: string; password: string }) => {
  const { email, password } = payload;

  const user = await UserRepository.findOneByEmail(email);
  if (!user) {
    throw new AppError('Invalid email or password. Please try again.', 401);
  }

  const checkPassword = await bcrypt.compare(password, user.password);
  if (!checkPassword) {
    throw new AppError('Invalid email or password. Please try again.', 401);
  }

  const accessToken = generateAccessToken(user.id);
  const rawRefreshToken = generateRefreshToken(user.id);
  const hashedRefreshToken = await hashToken(rawRefreshToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await UserRepository.updateRefreshToken(user.id, hashedRefreshToken, expiresAt);

  return { accessToken, refreshToken: rawRefreshToken };
};

const refresh = async (payload: { refreshToken: string }) => {
  const { refreshToken: rawRefreshToken } = payload;

  let decoded: { id: string };
  try {
    decoded = verifyRefreshToken(rawRefreshToken);
  } catch {
    throw new AppError('Session expired. Please log in again.', 401);
  }

  const user = await UserRepository.findById(decoded.id);
  if (!user || !user.refreshToken) {
    throw new AppError('Session expired. Please log in again.', 401);
  }

  const isTokenValid = await bcrypt.compare(rawRefreshToken, user.refreshToken);
  if (!isTokenValid) {
    throw new AppError('Session expired. Please log in again.', 401);
  }

  if (user.refreshTokenExpiresAt && user.refreshTokenExpiresAt < new Date()) {
    await UserRepository.updateRefreshToken(user.id, null, null);
    throw new AppError('Session expired. Please log in again.', 401);
  }

  const newAccessToken = generateAccessToken(user.id);
  const newRawRefreshToken = generateRefreshToken(user.id);
  const newHashedRefreshToken = await hashToken(newRawRefreshToken);
  const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await UserRepository.updateRefreshToken(user.id, newHashedRefreshToken, newExpiresAt);

  return { accessToken: newAccessToken, refreshToken: newRawRefreshToken };
};

const logout = async (userId: string) => {
  await UserRepository.updateRefreshToken(userId, null, null);
};

export default {
  signUp,
  login,
  refresh,
  logout,
};
