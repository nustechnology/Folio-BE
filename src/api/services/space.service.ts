import { StatusCodes } from 'http-status-codes';

import SpaceRepository from '~/prisma/repositories/space.repository';
import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';

type ListOptions = {
  search?: string;
  sort: 'recently-updated' | 'recently-created' | 'alphabetical-az' | 'alphabetical-za';
};

const list = async (ownerId: string, options: ListOptions) => {
  return SpaceRepository.findManyByOwner({ ownerId }, options);
};

const create = async (ownerId: string, data: { name: string; researchObjective?: string }) => {
  const existing = await SpaceRepository.findByNameAndOwner(ownerId, data.name);
  if (existing) {
    throw new AppError(
      'A space with this name already exists.',
      StatusCodes.CONFLICT,
      ErrorCode.SPACE_NAME_EXISTS,
    );
  }
  return SpaceRepository.create({
    ownerId,
    name: data.name,
    researchObjective: data.researchObjective ?? '',
  });
};

export default {
  list,
  create,
};
