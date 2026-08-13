import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import SpaceRepository from '~/prisma/repositories/space.repository';

/**
 * The ownership boundary every space-scoped resource sits behind. A space the
 * user does not own is reported as missing rather than forbidden, so the API
 * does not disclose which space ids exist.
 */
export const assertSpaceAccess = async (spaceId: string, ownerId: string) => {
  const space = await SpaceRepository.findByIdAndOwner(spaceId, ownerId);
  if (!space) {
    throw new AppError(
      'Research space not found.',
      StatusCodes.NOT_FOUND,
      ErrorCode.SPACE_NOT_FOUND
    );
  }
  return space;
};
