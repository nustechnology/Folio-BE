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

// Tolerates a `<bucket>/` prefix on a key that came back out of the database,
// where a value may have been persisted bucket-qualified. Deliberately NOT
// applied to keys this codebase builds: those start with a literal `sources/`,
// so a deployment whose bucket is named `sources` would see the segment
// stripped off every one of them and lose track of every stored object.
export const normalizeStoredObjectKey = (key: string): string =>
  key.startsWith(`${BUCKET_NAME}/`) ? key.slice(BUCKET_NAME.length + 1) : key;

// Upload an uploaded multer file (stored on disk at file.path) to MinIO,
// streaming it rather than buffering so memory stays flat.
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

// For images pulled out of a parsed document, which never touch the disk.
export const uploadBuffer = async (
  objectKey: string,
  body: Buffer,
  contentType: string
): Promise<void> => {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
      ContentLength: body.length
    })
  );
};

// True only when the store answered "that object isn't here". S3 reports it as
// `NoSuchKey`, and MinIO answers `NotFound` to some requests. Matched by name
// rather than by the 404 status they carry, because `NoSuchBucket` is a 404 too
// and a missing bucket is a deployment fault, not a missing file.
export const isObjectNotFoundError = (error: unknown): boolean => {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'NoSuchKey' || name === 'NotFound';
};

// Stream an object without buffering it whole, unlike downloadObject.
export const getObjectStream = async (
  objectKey: string
): Promise<{
  stream: Readable;
  contentType?: string;
  contentLength?: number;
}> => {
  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: objectKey })
  );
  return {
    stream: response.Body as Readable,
    contentType: response.ContentType,
    contentLength: response.ContentLength
  };
};

// Remove an object (used when a file source is deleted).
export const deleteObject = async (objectKey: string): Promise<void> => {
  await s3Client.send(
    new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: objectKey })
  );
};

// Remove everything under a key prefix. S3 pages at 1000 keys, hence the loop.
export const deleteObjectsByPrefix = async (prefix: string): Promise<void> => {
  // An empty prefix matches every key in the bucket, so a caller that computed
  // one from a missing id would empty the whole store instead of clearing one
  // source's folder. There is no legitimate "delete everything" caller.
  if (!prefix.trim()) {
    throw new Error(
      'deleteObjectsByPrefix requires a non-empty prefix; refusing to match the entire bucket'
    );
  }

  let continuationToken: string | undefined;
  let deletedCount = 0;
  const failed: { key?: string; code?: string; message?: string }[] = [];

  do {
    const listed = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
        ContinuationToken: continuationToken
      })
    );

    const keys = (listed.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => Boolean(key));

    if (keys.length > 0) {
      const deleted = await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET_NAME,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true }
        })
      );

      // A per-key failure comes back inside a 200 response, so the send() above
      // resolves happily while the objects are still there. Quiet mode reports
      // nothing but these errors. Collected rather than thrown here: bailing
      // mid-loop would leave the earlier pages already deleted with no record
      // of how far it got, so the remaining pages are still attempted and the
      // whole picture is reported once at the end.
      const errors = deleted.Errors ?? [];
      failed.push(
        ...errors.map((error) => ({
          key: error.Key,
          code: error.Code,
          message: error.Message
        }))
      );
      deletedCount += keys.length - errors.length;
    }

    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);

  // Logged as well as thrown: the deletion callers treat a failure here as
  // non-fatal, so without this the detail would go nowhere.
  if (failed.length > 0) {
    logger.error('Failed to delete objects under prefix', {
      bucket: BUCKET_NAME,
      prefix,
      deleted: deletedCount,
      failed: failed.length,
      errors: failed.slice(0, 5)
    });
    throw new Error(
      `Failed to delete ${failed.length} object(s) under "${prefix}" ` +
        `(${deletedCount} removed, first error: ${failed[0]?.code ?? 'unknown'})`
    );
  }
};

// Download an object fully into a Buffer — used by the extraction pipeline to
// pull the original file before parsing it.
export const downloadObject = async (objectKey: string): Promise<Buffer> => {
  const response = await s3Client.send(
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: objectKey })
  );
  const body = response.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};
