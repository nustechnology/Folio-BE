import crypto from 'crypto';
import fs from 'fs';

import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import { env } from '~/config/enviroment';
import { BUCKET_NAME } from '~/config/minio';
import { ListSourceOptions } from '~/api/types/source';
import { getContentType } from '~/api/utils/file.util';
import { deleteObject, uploadFile } from '~/api/utils/minio.util';
import {
  computeFileHash,
  verifyFileSignature
} from '~/api/utils/signature.util';
import { enqueueIngestion } from '~/queues/ingestion.queue';
import SourceRepository from '~/prisma/repositories/source.repository';
import SpaceRepository from '~/prisma/repositories/space.repository';
import UserRepository from '~/prisma/repositories/user.repository';
import PassageRepository from '~/prisma/repositories/passage.repository';

const verifySpaceOwnership = async (spaceId: string, userId: string) => {
  const space = await SpaceRepository.findByIdAndOwner(spaceId, userId);
  if (!space) {
    throw new AppError(
      'Space not found',
      StatusCodes.NOT_FOUND,
      ErrorCode.SPACE_NOT_FOUND
    );
  }
};

const verifySourceOwnership = async (sourceId: string, userId: string) => {
  const source = await SourceRepository.findById(sourceId);
  if (!source) {
    throw new AppError(
      'Source not found',
      StatusCodes.NOT_FOUND,
      ErrorCode.SOURCE_NOT_FOUND
    );
  }
  const space = await SpaceRepository.findByIdAndOwner(
    source.researchSpaceId,
    userId
  );
  if (!space) {
    throw new AppError(
      'Source not found',
      StatusCodes.NOT_FOUND,
      ErrorCode.SOURCE_NOT_FOUND
    );
  }
  return source;
};

const getUntitledDate = (): string => {
  return new Date().toISOString().slice(0, 10);
};

const getDomainFromUrl = (url: string): string | null => {
  try {
    const hostname = new URL(url).hostname;
    return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
  } catch {
    return null;
  }
};

const uploadFileToMinio = async (
  objectKey: string,
  file: Express.Multer.File
) => {
  try {
    await uploadFile(objectKey, file);
  } catch {
    throw new AppError(
      'Failed to upload file. Please try again.',
      StatusCodes.INTERNAL_SERVER_ERROR,
      ErrorCode.FILE_UPLOAD_FAILED
    );
  }
};

const createFile = async (
  spaceId: string,
  userId: string,
  file: Express.Multer.File,
  data: {
    title?: string;
    author?: string;
  }
) => {
  await verifySpaceOwnership(spaceId, userId);

  // 1. Validate the file signature (magic bytes) — the multer middleware only
  // checked the extension, so a renamed file (e.g. virus.exe → paper.pdf) is
  // rejected here. The temp file is cleaned up before throwing.
  const { valid, detectedMime } = await verifyFileSignature(
    file.path,
    file.originalname
  );
  if (!valid) {
    fs.unlink(file.path, () => {});
    throw new AppError(
      `The file content does not match its extension. Detected type: ${detectedMime ?? 'unknown'}.`,
      StatusCodes.BAD_REQUEST,
      ErrorCode.INVALID_FILE_SIGNATURE
    );
  }

  // 2. Compute a SHA-256 checksum (integrity + future deduplication).
  const fileHash = await computeFileHash(file.path);

  // 3. Namespaced, collision-safe MinIO object key.
  const objectKey = `sources/${crypto.randomUUID()}/${file.originalname}`;
  const contentType = getContentType(file.originalname);

  // 4. Upload the file to MinIO, removing the temp file on both success and
  // failure.
  try {
    await uploadFileToMinio(objectKey, file);
  } catch (error) {
    fs.unlink(file.path, () => {});
    throw error;
  }

  fs.unlink(file.path, () => {});

  // 5. Create the source record in `added` state (the async worker will pick it
  // up and run extraction → chunking → embedding → ready).
  const source = await SourceRepository.create({
    researchSpace: { connect: { id: spaceId } },
    sourceType: 'File',
    title: data.title || file.originalname,
    author: data.author || 'Unknown Author',
    sourceUrl: objectKey,
    fileName: file.originalname,
    fileType: contentType,
    fileSize: BigInt(file.size),
    fileHash,
    content: '',
    processingState: 'added'
  });

  // 6. Queue the ingestion job.
  await enqueueIngestion(source.id);
  return source;
};

const createWeb = async (
  spaceId: string,
  userId: string,
  data: {
    sourceUrl: string;
    title?: string;
    author?: string;
  }
) => {
  await verifySpaceOwnership(spaceId, userId);

  const source = await SourceRepository.create({
    researchSpace: { connect: { id: spaceId } },
    sourceType: 'Web',
    title: data.title || `Untitled Source - ${getUntitledDate()}`,
    author: data.author || getDomainFromUrl(data.sourceUrl) || 'Unknown Author',
    sourceUrl: data.sourceUrl,
    content: '',
    processingState: 'added'
  });

  await enqueueIngestion(source.id);
  return source;
};

const createManual = async (
  spaceId: string,
  userId: string,
  data: {
    content: string;
    title?: string;
    author?: string;
  }
) => {
  await verifySpaceOwnership(spaceId, userId);

  const user = await UserRepository.findById(userId);

  const source = await SourceRepository.create({
    researchSpace: { connect: { id: spaceId } },
    sourceType: 'Manual',
    title: data.title || `Untitled Source - ${getUntitledDate()}`,
    author: data.author || user?.name || 'Unknown Author',
    content: data.content,
    processingState: 'added'
  });

  await enqueueIngestion(source.id);
  return source;
};

const list = async (
  spaceId: string,
  userId: string,
  options: ListSourceOptions
) => {
  await verifySpaceOwnership(spaceId, userId);
  const { sources, totalCount } = await SourceRepository.findBySpaceId(
    spaceId,
    options
  );
  const totalPages = Math.ceil(totalCount / options.limit);
  return {
    sources,
    pagination: {
      page: options.page,
      limit: options.limit,
      totalCount,
      totalPages
    }
  };
};

const getById = async (sourceId: string, userId: string) => {
  return verifySourceOwnership(sourceId, userId);
};

const remove = async (sourceId: string, userId: string) => {
  const source = await verifySourceOwnership(sourceId, userId);

  if (source.sourceType === 'File' && source.sourceUrl) {
    try {
      await deleteObject(source.sourceUrl);
    } catch {
      // Object may already be gone; proceed with record deletion.
    }
  }

  await SourceRepository.deleteById(sourceId);
  return { success: true };
};

const retry = async (sourceId: string, userId: string) => {
  const source = await verifySourceOwnership(sourceId, userId);

  if (source.processingState !== 'failed') {
    throw new AppError(
      'Only failed sources can be retried.',
      StatusCodes.BAD_REQUEST,
      ErrorCode.SOURCE_NOT_FAILED
    );
  }

  const updated = await SourceRepository.update(sourceId, {
    processingState: 'added',
    processingError: null
  });

  await enqueueIngestion(sourceId);
  return updated;
};

const update = async (
  sourceId: string,
  userId: string,
  data: { title: string; author?: string | null; content?: string }
) => {
  const source = await verifySourceOwnership(sourceId, userId);

  const updatePayload: Record<string, any> = {
    title: data.title,
    author: data.author || 'Unknown Author'
  };

  // If content of a manual text source changed, wipe existing passages and re-enqueue ingestion
  if (
    source.sourceType === 'Manual' &&
    data.content !== undefined &&
    data.content !== source.content
  ) {
    updatePayload.content = data.content;
    updatePayload.characterCount = data.content.length;
    updatePayload.processingState = 'added';
    updatePayload.processingError = null;

    // Delete existing passages since the content has changed
    await PassageRepository.deleteBySourceId(sourceId);

    const updated = await SourceRepository.update(sourceId, updatePayload);
    await enqueueIngestion(sourceId);
    return updated;
  }

  return SourceRepository.update(sourceId, updatePayload);
};

const getPreviewUrl = async (
  sourceId: string,
  userId: string
): Promise<string | null> => {
  const source = await verifySourceOwnership(sourceId, userId);

  if (source.sourceType === 'Web') {
    return source.sourceUrl;
  }

  if (source.sourceType === 'File' && source.sourceUrl) {
    const protocol = env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
    const host =
      env.MINIO_ENDPOINT === 'minio' ? 'localhost' : env.MINIO_ENDPOINT;
    return `${protocol}://${host}:${env.MINIO_PORT}/${BUCKET_NAME}/${source.sourceUrl}`;
  }

  return null;
};

export default {
  createFile,
  createWeb,
  createManual,
  list,
  getById,
  update,
  remove,
  retry,
  getPreviewUrl
};
