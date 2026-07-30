import prisma from '~/prisma/prisma.client';

type ListOptions = {
  search?: string;
  sort: 'recently-updated' | 'recently-created' | 'alphabetical-az' | 'alphabetical-za';
};

type ListFilters = {
  ownerId: string;
  isArchived?: boolean;
};

const sortOrderMap: Record<ListOptions['sort'], Record<string, 'asc' | 'desc'>> = {
  'recently-updated': { updatedAt: 'desc' },
  'recently-created': { createdAt: 'desc' },
  'alphabetical-az': { name: 'asc' },
  'alphabetical-za': { name: 'desc' },
};

const findManyByOwner = async (filters: ListFilters, options: ListOptions) => {
  const where: any = {
    ownerId: filters.ownerId,
    isArchived: filters.isArchived ?? false,
  };

  if (options.search) {
    where.OR = [
      { name: { contains: options.search, mode: 'insensitive' } },
      { researchObjective: { contains: options.search, mode: 'insensitive' } },
    ];
  }

  const records = await prisma.researchSpace.findMany({
    where,
    include: {
      _count: {
        select: {
          sources: true,
          notes: true,
        },
      },
    },
    orderBy: sortOrderMap[options.sort],
  });

  return records.map(({ _count, ...rest }) => ({
    ...rest,
    sourceCount: _count.sources,
    noteCount: _count.notes,
  }));
};

const findByNameAndOwner = async (ownerId: string, name: string) => {
  return prisma.researchSpace.findFirst({
    where: { ownerId, name: { equals: name, mode: 'insensitive' } },
  });
};

const create = async (data: { ownerId: string; name: string; researchObjective: string }) => {
  const record = await prisma.researchSpace.create({
    data,
    include: {
      _count: {
        select: {
          sources: true,
          notes: true,
        },
      },
    },
  });
  const { _count, ...rest } = record;
  return { ...rest, sourceCount: _count.sources, noteCount: _count.notes };
};

export default {
  findManyByOwner,
  findByNameAndOwner,
  create,
};
