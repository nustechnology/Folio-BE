import { StatusCodes } from 'http-status-codes';

import { ListOptions } from '~/api/types/space';
import SpaceRepository from '~/prisma/repositories/space.repository';
import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';

const list = async (ownerId: string, options: ListOptions) => {
  const { spaces, totalCount } = await SpaceRepository.findManyByOwner(
    { ownerId },
    options
  );
  const totalPages = Math.ceil(totalCount / options.limit);
  return {
    spaces,
    pagination: {
      page: options.page,
      limit: options.limit,
      totalCount,
      totalPages
    }
  };
};

/**
 * Not found rather than forbidden for someone else's space, matching every
 * other space-scoped route (`assertSpaceAccess`).
 */
const getById = async (ownerId: string, spaceId: string) => {
  const space = await SpaceRepository.findDetailByIdAndOwner(spaceId, ownerId);

  if (!space) {
    throw new AppError(
      'Research space not found.',
      StatusCodes.NOT_FOUND,
      ErrorCode.SPACE_NOT_FOUND
    );
  }

  return space;
};

const create = async (
  ownerId: string,
  data: { name: string; researchObjective?: string }
) => {
  const existing = await SpaceRepository.findByNameAndOwner(ownerId, data.name);
  if (existing) {
    throw new AppError(
      'A space with this name already exists.',
      StatusCodes.CONFLICT,
      ErrorCode.SPACE_NAME_EXISTS
    );
  }
  return SpaceRepository.create({
    ownerId,
    name: data.name,
    researchObjective: data.researchObjective ?? ''
  });
};

const update = async (
  ownerId: string,
  id: string,
  data: { name?: string; researchObjective?: string }
) => {
  const existing = await SpaceRepository.findByIdAndOwner(id, ownerId);
  if (!existing) {
    throw new AppError(
      'Space not found.',
      StatusCodes.NOT_FOUND,
      ErrorCode.SPACE_NOT_FOUND
    );
  }

  if (data.name !== undefined) {
    const duplicate = await SpaceRepository.findByNameAndOwnerExcluding(
      data.name,
      ownerId,
      id
    );
    if (duplicate) {
      throw new AppError(
        'A space with this name already exists.',
        StatusCodes.CONFLICT,
        ErrorCode.SPACE_NAME_EXISTS
      );
    }
  }

  return SpaceRepository.update(id, data);
};

const remove = async (ownerId: string, id: string) => {
  const existing = await SpaceRepository.findByIdAndOwner(id, ownerId);
  if (!existing) {
    throw new AppError(
      'Space not found.',
      StatusCodes.NOT_FOUND,
      ErrorCode.SPACE_NOT_FOUND
    );
  }

  return SpaceRepository.remove(id);
};

export default {
  list,
  getById,
  create,
  update,
  remove
};
