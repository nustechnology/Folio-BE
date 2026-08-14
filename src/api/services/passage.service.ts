import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import PassageRepository from '~/prisma/repositories/passage.repository';
import SourceRepository from '~/prisma/repositories/source.repository';
import SpaceRepository from '~/prisma/repositories/space.repository';

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

const getById = async (passageId: string, userId: string) => {
  const passage = await PassageRepository.findById(passageId);

  if (!passage) {
    throw new AppError(
      'Passage not found',
      StatusCodes.NOT_FOUND,
      ErrorCode.PASSAGE_NOT_FOUND
    );
  }

  // Verify that the user owns the space containing the parent source of this passage
  await verifySourceOwnership(passage.sourceId, userId);

  return passage;
};

export default {
  getById
};
