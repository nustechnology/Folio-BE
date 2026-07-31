import * as dotenv from 'dotenv';

dotenv.config();

interface EnvInterface {
  SERVER_PORT: string;
  NODE_ENV: string;
  LOG_LEVEL: string;
  DATABASE_URL: string;
  JWT_TOKEN_SECRET: string;
  REFRESH_TOKEN_SECRET: string;
  ACCESS_TOKEN_EXPIRATION: string;
  REFRESH_TOKEN_EXPIRATION: string;
  CORS_ORIGIN: string;
  SEED_USER_PASSWORD: string;
}

const nodeEnv = process.env.NODE_ENV || '';

export const env: EnvInterface = {
  SERVER_PORT: process.env.PORT || '',
  NODE_ENV: nodeEnv,
  LOG_LEVEL:
    process.env.LOG_LEVEL || (nodeEnv === 'production' ? 'info' : 'debug'),
  DATABASE_URL: process.env.DATABASE_URL || '',
  JWT_TOKEN_SECRET: process.env.JWT_TOKEN_SECRET || '',
  REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET || '',
  ACCESS_TOKEN_EXPIRATION: process.env.ACCESS_TOKEN_EXPIRATION || '15m',
  REFRESH_TOKEN_EXPIRATION: process.env.REFRESH_TOKEN_EXPIRATION || '30d',
  CORS_ORIGIN:
    process.env.CORS_ORIGIN ||
    (nodeEnv === 'production' ? '' : 'http://localhost:3000'),
  SEED_USER_PASSWORD: process.env.SEED_USER_PASSWORD || ''
};

const missing = [
  ['JWT_TOKEN_SECRET', env.JWT_TOKEN_SECRET],
  ['REFRESH_TOKEN_SECRET', env.REFRESH_TOKEN_SECRET],
  ...(nodeEnv === 'production' ? [['CORS_ORIGIN', env.CORS_ORIGIN]] : [])
]
  .filter(([, v]) => !v || v.trim().length === 0)
  .map(([k]) => k);

if (missing.length > 0) {
  throw new Error(
    `Missing required environment variable(s): ${missing.join(', ')}`
  );
}
