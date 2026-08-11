import { Prisma } from '~/generated/prisma/client';
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

const deleteById = async (id: string) => {
  return prisma.source.delete({ where: { id } });
};

const countBySpaceId = async (spaceId: string) => {
  return prisma.source.count({ where: { researchSpaceId: spaceId } });
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
  update,
  deleteById,
  countBySpaceId,
  findByOriginalNoteId,
  findManyByOwnerId
};
