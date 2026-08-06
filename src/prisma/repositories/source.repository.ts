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

  return prisma.source.findMany({
    where,
    orderBy: sortOrderMap[options.sort]
  });
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
  findBySpaceId,
  update,
  deleteById,
  countBySpaceId,
  findManyByOwnerId
};
