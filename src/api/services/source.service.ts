import crypto from 'crypto';
import fs from 'fs';

import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import { ListSourceOptions } from '~/api/types/source';
import { getContentType } from '~/api/utils/file.util';
import { deleteObject, uploadFile } from '~/api/utils/minio.util';
import SourceRepository from '~/prisma/repositories/source.repository';
import SpaceRepository from '~/prisma/repositories/space.repository';
import UserRepository from '~/prisma/repositories/user.repository';

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

  const objectKey = `sources/${crypto.randomUUID()}/${file.originalname}`;
  const contentType = getContentType(file.originalname);

  try {
    await uploadFileToMinio(objectKey, file);
  } catch (error) {
    fs.unlink(file.path, () => {});
    throw error;
  }

  fs.unlink(file.path, () => {});

  return SourceRepository.create({
    researchSpace: { connect: { id: spaceId } },
    sourceType: 'File',
    title: data.title || file.originalname,
    author: data.author || 'Unknown Author',
    sourceUrl: objectKey,
    fileName: file.originalname,
    fileType: contentType,
    fileSize: BigInt(file.size),
    content: '',
    processingState: 'added'
  });
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

  return SourceRepository.create({
    researchSpace: { connect: { id: spaceId } },
    sourceType: 'Web',
    title: data.title || `Untitled Source - ${getUntitledDate()}`,
    author: data.author || getDomainFromUrl(data.sourceUrl) || 'Unknown Author',
    sourceUrl: data.sourceUrl,
    content: '',
    processingState: 'added'
  });
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

  return SourceRepository.create({
    researchSpace: { connect: { id: spaceId } },
    sourceType: 'Manual',
    title: data.title || `Untitled Source - ${getUntitledDate()}`,
    author: data.author || user?.name || 'Unknown Author',
    content: data.content,
    processingState: 'added'
  });
};

const list = async (
  spaceId: string,
  userId: string,
  options: ListSourceOptions
) => {
  await verifySpaceOwnership(spaceId, userId);
  return SourceRepository.findBySpaceId(spaceId, options);
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

  return SourceRepository.update(sourceId, {
    processingState: 'added',
    processingError: null
  });
};

export default {
  createFile,
  createWeb,
  createManual,
  list,
  getById,
  remove,
  retry
};
