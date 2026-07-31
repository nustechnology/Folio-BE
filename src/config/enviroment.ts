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
  MINIO_ENDPOINT: string;
  MINIO_PORT: string;
  MINIO_ROOT_USER: string;
  MINIO_ROOT_PASSWORD: string;
  MINIO_BUCKET_NAME: string;
  MINIO_USE_SSL: string;
  MULTER_TEMP_DIR: string;
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
  SEED_USER_PASSWORD: process.env.SEED_USER_PASSWORD || '',
  MINIO_ENDPOINT: process.env.MINIO_ENDPOINT || 'localhost',
  MINIO_PORT: process.env.MINIO_PORT || '9000',
  MINIO_ROOT_USER: process.env.MINIO_ROOT_USER || 'minioadmin',
  MINIO_ROOT_PASSWORD: process.env.MINIO_ROOT_PASSWORD || 'minioadmin',
  MINIO_BUCKET_NAME: process.env.MINIO_BUCKET_NAME || 'folio-sources',
  MINIO_USE_SSL: process.env.MINIO_USE_SSL || 'false',
  MULTER_TEMP_DIR: process.env.MULTER_TEMP_DIR || ''
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
