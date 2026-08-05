import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import { ListOptions } from '~/api/types/space';
import { Prisma } from '~/generated/prisma/client';
import prisma from '~/prisma/prisma.client';

type ListFilters = {
  ownerId: string;
  isArchived?: boolean;
};

const sortOrderMap: Record<
  ListOptions['sort'],
  Record<string, 'asc' | 'desc'>
> = {
  'recently-updated': { updatedAt: 'desc' },
  'recently-created': { createdAt: 'desc' },
  'alphabetical-az': { name: 'asc' },
  'alphabetical-za': { name: 'desc' }
};

const findManyByOwner = async (filters: ListFilters, options: ListOptions) => {
  const where: Prisma.ResearchSpaceWhereInput = {
    ownerId: filters.ownerId,
    isArchived: filters.isArchived ?? false
  };

  if (options.search) {
    where.OR = [
      { name: { contains: options.search, mode: 'insensitive' } },
      { researchObjective: { contains: options.search, mode: 'insensitive' } }
    ];
  }

  const [records, totalCount] = await Promise.all([
    prisma.researchSpace.findMany({
      where,
      include: {
        _count: {
          select: {
            sources: true,
            notes: true
          }
        }
      },
      orderBy: sortOrderMap[options.sort],
      skip: (options.page - 1) * options.limit,
      take: options.limit
    }),
    prisma.researchSpace.count({ where })
  ]);

  const spaces = records.map(({ _count, ...rest }) => ({
    ...rest,
    sourceCount: _count.sources,
    noteCount: _count.notes
  }));

  return { spaces, totalCount };
};

const findByNameAndOwner = async (ownerId: string, name: string) => {
  return prisma.researchSpace.findFirst({
    where: { ownerId, name: { equals: name, mode: 'insensitive' } }
  });
};

const findByNameAndOwnerExcluding = async (
  name: string,
  ownerId: string,
  excludeId: string
) => {
  return prisma.researchSpace.findFirst({
    where: {
      ownerId,
      name: { equals: name, mode: 'insensitive' },
      id: { not: excludeId }
    }
  });
};

const findByIdAndOwner = async (id: string, ownerId: string) => {
  return prisma.researchSpace.findFirst({
    where: { id, ownerId }
  });
};

const findByIdAndOwnerWithCounts = async (id: string, ownerId: string) => {
  const record = await prisma.researchSpace.findFirst({
    where: { id, ownerId },
    include: {
      _count: {
        select: {
          sources: true,
          notes: true
        }
      }
    }
  });

  if (!record) return null;

  const { _count, ...rest } = record;
  return { ...rest, sourceCount: _count.sources, noteCount: _count.notes };
};

const create = async (data: {
  ownerId: string;
  name: string;
  researchObjective: string;
}) => {
  try {
    const record = await prisma.researchSpace.create({
      data,
      include: {
        _count: {
          select: {
            sources: true,
            notes: true
          }
        }
      }
    });
    const { _count, ...rest } = record;
    return { ...rest, sourceCount: _count.sources, noteCount: _count.notes };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new AppError(
        'A space with this name already exists.',
        StatusCodes.CONFLICT,
        ErrorCode.SPACE_NAME_EXISTS
      );
    }
    throw error;
  }
};

const update = async (
  id: string,
  data: { name?: string; researchObjective?: string }
) => {
  const record = await prisma.researchSpace.update({
    where: { id },
    data,
    include: {
      _count: {
        select: {
          sources: true,
          notes: true
        }
      }
    }
  });
  const { _count, ...rest } = record;
  return { ...rest, sourceCount: _count.sources, noteCount: _count.notes };
};

const remove = async (id: string) => {
  await prisma.$transaction([
    prisma.noteCitation.deleteMany({
      where: {
        OR: [
          { note: { researchSpaceId: id } },
          { citation: { source: { researchSpaceId: id } } }
        ]
      }
    }),
    prisma.citation.deleteMany({
      where: { source: { researchSpaceId: id } }
    }),
    prisma.source.deleteMany({ where: { researchSpaceId: id } }),
    prisma.note.deleteMany({ where: { researchSpaceId: id } }),
    prisma.conversation.deleteMany({ where: { researchSpaceId: id } }),
    prisma.notebook.deleteMany({ where: { researchSpaceId: id } }),
    prisma.researchSpace.delete({ where: { id } })
  ]);
};

export default {
  findManyByOwner,
  findByNameAndOwner,
  findByNameAndOwnerExcluding,
  findByIdAndOwner,
  findByIdAndOwnerWithCounts,
  create,
  update,
  remove
};
