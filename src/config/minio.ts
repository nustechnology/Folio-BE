import { S3Client } from '@aws-sdk/client-s3';

import { env } from '~/config/enviroment';

// MinIO is S3-compatible, so the AWS S3 SDK is used against it. All object
// storage operations live in src/api/utils/minio.util.ts; this module only
// owns the client + bucket configuration.
const useSsl = env.MINIO_USE_SSL === 'true';

export const s3Client = new S3Client({
  endpoint: `${useSsl ? 'https' : 'http'}://${env.MINIO_ENDPOINT}:${env.MINIO_PORT}`,
  region: 'us-east-1',
  credentials: {
    accessKeyId: env.MINIO_ROOT_USER,
    secretAccessKey: env.MINIO_ROOT_PASSWORD
  },
  // MinIO doesn't use virtual-hosted-style buckets (S3-style DNS names), so
  // requests must use the path style (host/bucket/key).
  forcePathStyle: true
});

export const BUCKET_NAME = env.MINIO_BUCKET_NAME;
