import fs from 'fs';
import { Readable } from 'stream';

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
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

// For images pulled out of a parsed document, which never touch the disk.
export const uploadBuffer = async (
  objectKey: string,
  body: Buffer,
  contentType: string
): Promise<void> => {
  const cleanKey = getCleanKey(objectKey);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: cleanKey,
      Body: body,
      ContentType: contentType,
      ContentLength: body.length
    })
  );
};

// Stream an object without buffering it whole, unlike downloadObject.
export const getObjectStream = async (
  objectKey: string
): Promise<{
  stream: Readable;
  contentType?: string;
  contentLength?: number;
}> => {
  const cleanKey = getCleanKey(objectKey);
  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: cleanKey })
  );
  return {
    stream: response.Body as Readable,
    contentType: response.ContentType,
    contentLength: response.ContentLength
  };
};

// Remove an object (used when a file source is deleted).
export const deleteObject = async (objectKey: string): Promise<void> => {
  const cleanKey = getCleanKey(objectKey);
  await s3Client.send(
    new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: cleanKey })
  );
};

// Remove everything under a key prefix. S3 pages at 1000 keys, hence the loop.
export const deleteObjectsByPrefix = async (prefix: string): Promise<void> => {
  const cleanPrefix = getCleanKey(prefix);
  let continuationToken: string | undefined;

  do {
    const listed = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: cleanPrefix,
        ContinuationToken: continuationToken
      })
    );

    const keys = (listed.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => Boolean(key));

    if (keys.length > 0) {
      await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET_NAME,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true }
        })
      );
    }

    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);
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
