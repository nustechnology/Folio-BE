import { StatusCodes } from 'http-status-codes';

import { ListOptions, UpdateSpaceInput } from '~/api/types/space';
import SourceRepository from '~/prisma/repositories/source.repository';
import SpaceRepository from '~/prisma/repositories/space.repository';
import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import { assertSpaceAccess } from '~/api/services/space-access';
import { mediaPrefix } from '~/api/services/media.service';
import {
  deleteObject,
  deleteObjectsByPrefix,
  normalizeStoredObjectKey
} from '~/api/utils/minio.util';
import { Prisma, SourceType } from '~/generated/prisma/client';
import { STORAGE_CLEANUP_CONCURRENCY } from '~/api/utils/constants';
import logger from '~/config/logger';

const list = async (ownerId: string, options: ListOptions) => {
  const { spaces, totalCount } = await SpaceRepository.findManyByOwner(
    { ownerId, isArchived: options.archived ?? false },
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

/**
 * Only the fields actually sent are written, so an omitted field is left alone
 * while an explicit `researchObjective: ''` still clears it. Exported for the
 * unit test: this filter is where a partial update quietly becomes a full
 * overwrite.
 */
export const buildSpaceUpdateData = (
  input: UpdateSpaceInput
): Prisma.ResearchSpaceUpdateInput => {
  const data: Prisma.ResearchSpaceUpdateInput = {};

  if (input.name !== undefined) {
    data.name = input.name.trim();
  }
  if (input.researchObjective !== undefined) {
    data.researchObjective = input.researchObjective.trim();
  }
  if (input.isArchived !== undefined) {
    data.isArchived = input.isArchived;
  }

  return data;
};

/**
 * A name collision only counts when the row it hits is a *different* space —
 * otherwise renaming a space to the name it already has, or editing only its
 * objective, would answer 409 against itself.
 */
export const isNameTakenByAnother = (
  existing: { id: string } | null,
  spaceId: string
): boolean => existing !== null && existing.id !== spaceId;

const update = async (
  ownerId: string,
  spaceId: string,
  input: UpdateSpaceInput
) => {
  await assertSpaceAccess(spaceId, ownerId);

  if (input.name !== undefined) {
    const existing = await SpaceRepository.findByNameAndOwner(
      ownerId,
      input.name.trim()
    );
    if (isNameTakenByAnother(existing, spaceId)) {
      throw new AppError(
        'A space with this name already exists.',
        StatusCodes.CONFLICT,
        ErrorCode.SPACE_NAME_EXISTS
      );
    }
  }

  // The pre-check above is a nicety for the common case; the repository's
  // `P2002` catch is what actually holds, since the unique index is
  // case-insensitive and two renames can race between the read and the write.
  return SpaceRepository.update(spaceId, ownerId, buildSpaceUpdateData(input));
};

/**
 * The stored objects belonging to one source: the uploaded file, and the
 * prefix its extracted images live under.
 *
 * Unlike the single-source delete in `source.service`, failures are NOT
 * swallowed here — see `remove` for why. `deleteObject` is idempotent on S3 (a
 * key that is already gone is not an error) and `deleteObjectsByPrefix`
 * resolves when a prefix holds nothing, so anything that does throw is real
 * storage trouble rather than a missing object.
 */
const purgeSourceStorage = async (source: {
  id: string;
  sourceType: SourceType;
  sourceUrl: string | null;
}): Promise<void> => {
  if (source.sourceType === 'File' && source.sourceUrl) {
    await deleteObject(normalizeStoredObjectKey(source.sourceUrl));
  }

  // Extracted images live under their own prefix and would otherwise be left
  // behind.
  await deleteObjectsByPrefix(mediaPrefix(source.id));
};

/**
 * Permanent, and it takes every source, note, conversation and the notebook
 * with it — see `SpaceRepository.deleteWithChildren` for the order the foreign
 * keys force.
 *
 * Object storage is cleaned first, on purpose, and a storage failure aborts
 * the whole delete: the space is left wholly intact and the client can retry,
 * which is safe because purging is idempotent. Doing it the other way round —
 * or swallowing the failure, as an earlier revision did — would leave the rows
 * deleted and the files stranded with nothing left pointing at them to find
 * later. The one cost of this order is that a failure part-way through can
 * leave earlier sources' objects already gone from a space that still exists;
 * those sources cannot be re-read, so the retry is the fix rather than an
 * optional cleanup.
 *
 * Bounded concurrency rather than a serial loop: a space has no cap on how
 * many sources it holds, and two S3 round-trips each would otherwise hold the
 * request open long enough for the client to time out and retry into itself.
 */
const remove = async (ownerId: string, spaceId: string) => {
  await assertSpaceAccess(spaceId, ownerId);

  const sources = await SourceRepository.findStorageRefsBySpaceId(spaceId);

  for (let i = 0; i < sources.length; i += STORAGE_CLEANUP_CONCURRENCY) {
    const batch = sources.slice(i, i + STORAGE_CLEANUP_CONCURRENCY);

    try {
      await Promise.all(batch.map(purgeSourceStorage));
    } catch (error) {
      logger.error('Aborting space delete: object storage cleanup failed', {
        spaceId,
        purgedSources: i,
        totalSources: sources.length,
        error: error instanceof Error ? error.message : String(error)
      });

      throw new AppError(
        "Could not remove this space's stored files. The space was not deleted — please try again.",
        StatusCodes.SERVICE_UNAVAILABLE,
        ErrorCode.STORAGE_CLEANUP_FAILED
      );
    }
  }

  await SpaceRepository.deleteWithChildren(spaceId);

  return { deleted: true };
};

export default {
  list,
  getById,
  create,
  update,
  remove
};
