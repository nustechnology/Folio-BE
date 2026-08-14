import { StatusCodes } from 'http-status-codes';

import { ListOptions } from '~/api/types/space';
import SourceService from '~/api/services/source.service';
import SourceRepository from '~/prisma/repositories/source.repository';
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
const spaceNotFound = () =>
  new AppError(
    'Research space not found.',
    StatusCodes.NOT_FOUND,
    ErrorCode.SPACE_NOT_FOUND
  );

const getById = async (ownerId: string, spaceId: string) => {
  const space = await SpaceRepository.findDetailByIdAndOwner(spaceId, ownerId);

  if (!space) {
    throw spaceNotFound();
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

// Storage purges are independent of each other and swallow their own failures,
// so they fan out — a space with dozens of sources would otherwise serialize
// two round-trips each while the caller waits. Bounded rather than unbounded to
// keep one delete from saturating the storage client's socket pool.
const PURGE_CONCURRENCY = 8;

/**
 * Deletes a space with everything inside it.
 *
 * The rows go first and object storage second. The keys were read out before
 * the delete, so they survive the transaction either way — and doing it in this
 * order means a failed transaction leaves the space intact rather than leaving
 * every source pointing at a file that no longer exists. Each purge is
 * best-effort past that point: the rows are already gone, and an orphaned
 * upload is the cheaper failure.
 */
const remove = async (ownerId: string, spaceId: string) => {
  // Only the ownership check is needed here, not the list projection `getById`
  // builds — its `_count` subqueries would be thrown away.
  const space = await SpaceRepository.findByIdAndOwner(spaceId, ownerId);
  if (!space) {
    throw spaceNotFound();
  }

  const sources = await SourceRepository.findStorageRefsBySpaceId(spaceId);

  const deleted = await SpaceRepository.deleteByIdAndOwner(spaceId, ownerId);
  if (!deleted) {
    // Lost a race with a concurrent delete — the same 404 the pre-check gives.
    throw spaceNotFound();
  }

  for (let index = 0; index < sources.length; index += PURGE_CONCURRENCY) {
    await Promise.all(
      sources
        .slice(index, index + PURGE_CONCURRENCY)
        .map((source) => SourceService.purgeStoredObjects(source))
    );
  }

  return { success: true };
};

export default {
  list,
  getById,
  create,
  remove
};
