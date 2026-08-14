import { Prisma } from '~/generated/prisma/client';
import type { ProcessingState } from '~/generated/prisma/enums';
import { ListSourceOptions } from '~/api/types/source';
import prisma from '~/prisma/prisma.client';

const sortOrderMap: Record<
  ListSourceOptions['sort'],
  Record<string, 'asc' | 'desc'>
> = {
  'recently-added': { createdAt: 'desc' },
  'alphabetical-az': { title: 'asc' },
  'alphabetical-za': { title: 'desc' }
};

const create = async (data: Prisma.SourceCreateInput) => {
  return prisma.source.create({ data });
};

const findById = async (id: string) => {
  return prisma.source.findFirst({ where: { id } });
};

const findManyByIds = async (ids: string[]) => {
  if (ids.length === 0) {
    return [];
  }
  return prisma.source.findMany({ where: { id: { in: ids } } });
};

const countReadyBySpaceId = async (spaceId: string) => {
  return prisma.source.count({
    where: { researchSpaceId: spaceId, processingState: 'ready' }
  });
};

const findBySpaceId = async (spaceId: string, options: ListSourceOptions) => {
  const where: Prisma.SourceWhereInput = {
    researchSpaceId: spaceId
  };

  if (options.sourceType) {
    where.sourceType = options.sourceType;
  }

  if (options.processingState) {
    where.processingState = options.processingState;
  }

  if (options.search) {
    where.OR = [
      { title: { contains: options.search, mode: 'insensitive' } },
      { author: { contains: options.search, mode: 'insensitive' } }
    ];
  }

  const [sources, totalCount] = await Promise.all([
    prisma.source.findMany({
      where,
      orderBy: sortOrderMap[options.sort],
      skip: (options.page - 1) * options.limit,
      take: options.limit
    }),
    prisma.source.count({ where })
  ]);

  return { sources, totalCount };
};

const update = async (id: string, data: Prisma.SourceUpdateInput) => {
  return prisma.source.update({
    where: { id },
    data
  });
};

// Editing a manual source's text invalidates every passage cut from the old
// text. The two writes have to land together: dropping the passages first and
// then failing to write the new state leaves a source that still reports itself
// ready while having nothing left to retrieve, and nothing queued to rebuild it.
const updateClearingPassages = async (
  id: string,
  data: Prisma.SourceUpdateInput
) => {
  const [, updated] = await prisma.$transaction([
    prisma.passage.deleteMany({ where: { sourceId: id } }),
    prisma.source.update({ where: { id }, data })
  ]);
  return updated;
};

const deleteById = async (id: string) => {
  return prisma.source.delete({ where: { id } });
};

// Only what deleting a space needs to clean up object storage — the row itself
// goes with the space's own cascade, so the text columns are never loaded.
const findStorageRefsBySpaceId = async (spaceId: string) => {
  return prisma.source.findMany({
    where: { researchSpaceId: spaceId },
    select: { id: true, sourceType: true, sourceUrl: true }
  });
};

const countBySpaceId = async (spaceId: string) => {
  return prisma.source.count({ where: { researchSpaceId: spaceId } });
};

// Sources to re-index, oldest first. Only light columns, so a large corpus
// isn't pulled into memory at once; text is loaded per source as it runs.
const findManyForReindex = async (filter: {
  spaceId?: string;
  sourceIds?: string[];
  processingState?: ProcessingState;
}) => {
  const where: Prisma.SourceWhereInput = {};

  if (filter.spaceId) {
    where.researchSpaceId = filter.spaceId;
  }
  if (filter.sourceIds && filter.sourceIds.length > 0) {
    where.id = { in: filter.sourceIds };
  }
  if (filter.processingState) {
    where.processingState = filter.processingState;
  }

  return prisma.source.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      title: true,
      sourceType: true,
      processingState: true,
      characterCount: true
    }
  });
};

/**
 * A note has at most one snapshot source: `originalNoteId` is only an index, not
 * unique, so the "already converted" rule is enforced here rather than by the
 * database.
 */
const findByOriginalNoteId = async (originalNoteId: string) => {
  return prisma.source.findFirst({ where: { originalNoteId } });
};

const findManyByOwnerId = async (ownerId: string) => {
  return prisma.source.findMany({
    where: {
      researchSpace: {
        ownerId
      }
    }
  });
};

export default {
  create,
  findById,
  findManyByIds,
  countReadyBySpaceId,
  findBySpaceId,
  findManyForReindex,
  update,
  updateClearingPassages,
  deleteById,
  findStorageRefsBySpaceId,
  countBySpaceId,
  findByOriginalNoteId,
  findManyByOwnerId
};
