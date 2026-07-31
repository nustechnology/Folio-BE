import { S3Client } from '@aws-sdk/client-s3';

import { env } from '~/config/enviroment';

const useSsl = env.MINIO_USE_SSL === 'true';

export const s3Client = new S3Client({
  endpoint: `${useSsl ? 'https' : 'http'}://${env.MINIO_ENDPOINT}:${env.MINIO_PORT}`,
  region: 'us-east-1',
  credentials: {
    accessKeyId: env.MINIO_ROOT_USER,
    secretAccessKey: env.MINIO_ROOT_PASSWORD
  },
  forcePathStyle: true
});

export const BUCKET_NAME = env.MINIO_BUCKET_NAME;
