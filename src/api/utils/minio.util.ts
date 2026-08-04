import fs from 'fs';
import { Readable } from 'stream';

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand
} from '@aws-sdk/client-s3';

import { getContentType } from '~/api/utils/file.util';
import { BUCKET_NAME, s3Client } from '~/config/minio';
import logger from '~/config/logger';

// Centralized MinIO (S3-compatible) operations. All object storage access goes
// through this module; the S3Client itself lives in src/config/minio.ts.

// Called once at startup — creates the bucket if it doesn't exist.
export const ensureBucket = async (): Promise<void> => {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
  } catch {
    await s3Client.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
    logger.info('Created MinIO bucket', { bucket: BUCKET_NAME });
  }
};

const getCleanKey = (key: string): string => {
  if (key.startsWith(`${BUCKET_NAME}/`)) {
    return key.substring(BUCKET_NAME.length + 1);
  }
  return key;
};

// Upload an uploaded multer file (stored on disk at file.path) to MinIO,
// streaming it rather than buffering so memory stays flat.
export const uploadFile = async (
  objectKey: string,
  file: Express.Multer.File
): Promise<void> => {
  const cleanKey = getCleanKey(objectKey);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: cleanKey,
      Body: fs.createReadStream(file.path),
      ContentType: getContentType(file.originalname),
      ContentLength: file.size
    })
  );
};

// Remove an object (used when a file source is deleted).
export const deleteObject = async (objectKey: string): Promise<void> => {
  const cleanKey = getCleanKey(objectKey);
  await s3Client.send(
    new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: cleanKey })
  );
};

// Download an object fully into a Buffer — used by the extraction pipeline to
// pull the original file before parsing it.
export const downloadObject = async (objectKey: string): Promise<Buffer> => {
  const cleanKey = getCleanKey(objectKey);
  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: cleanKey })
  );
  const body = response.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};
