import fs from 'fs';

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand
} from '@aws-sdk/client-s3';

import { getContentType } from '~/api/utils/file.util';
import { BUCKET_NAME, s3Client } from '~/config/minio';
import logger from '~/config/logger';

export const ensureBucket = async (): Promise<void> => {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
  } catch {
    await s3Client.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
    logger.info('Created MinIO bucket', { bucket: BUCKET_NAME });
  }
};

export const uploadFile = async (
  objectKey: string,
  file: Express.Multer.File
): Promise<void> => {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: objectKey,
      Body: fs.createReadStream(file.path),
      ContentType: getContentType(file.originalname),
      ContentLength: file.size
    })
  );
};

export const deleteObject = async (objectKey: string): Promise<void> => {
  await s3Client.send(
    new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: objectKey })
  );
};
