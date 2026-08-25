import { StatusCodes } from 'http-status-codes';

import { AppError } from '~/api/errors/app.error';
import { ErrorCode } from '~/api/errors/error-codes';
import { ListOptions } from '~/api/types/space';
import { Prisma } from '~/generated/prisma/client';
import prisma from '~/prisma/prisma.client';
import { escapeLikePattern } from '~/prisma/repositories/search.util';

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
    const search = escapeLikePattern(options.search);
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { researchObjective: { contains: search, mode: 'insensitive' } }
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

const findByIdAndOwner = async (id: string, ownerId: string) => {
  return prisma.researchSpace.findFirst({ where: { id, ownerId } });
};

/**
 * The list projection for a single space. Counts come from the same `_count`
 * select the list uses, so the sidebar's "N sources · N notes" cannot drift
 * from the number the spaces grid shows.
 */
const findDetailByIdAndOwner = async (id: string, ownerId: string) => {
  const record = await prisma.researchSpace.findFirst({
    where: { id, ownerId },
    include: { _count: { select: { sources: true, notes: true } } }
  });

  if (!record) return null;

  const { _count, ...rest } = record;
  return { ...rest, sourceCount: _count.sources, noteCount: _count.notes };
};

const findByNameAndOwner = async (ownerId: string, name: string) => {
  return prisma.researchSpace.findFirst({
    where: { ownerId, name: { equals: name, mode: 'insensitive' } }
  });
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

/**
 * Scoped by `ownerId` in the same `where` as the id, so a space belonging to
 * someone else raises `P2025` rather than being written to — the write is the
 * ownership boundary, not a preceding read that could go stale.
 *
 * Returns the same `sourceCount` / `noteCount` projection the list, detail and
 * create paths return, so a rename's response is byte-identical to a
 * subsequent `GET /spaces/:spaceId`.
 */
const update = async (
  id: string,
  ownerId: string,
  data: Prisma.ResearchSpaceUpdateInput
) => {
  try {
    const record = await prisma.researchSpace.update({
      where: { id, ownerId },
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

/**
 * Every child foreign key pointing at `ResearchSpace` is `ON DELETE RESTRICT`
 * (see the init migration), so the rows have to go in dependency order or the
 * space delete fails with `P2003`. The order below is load-bearing — do not
 * "simplify" it:
 *
 * 1. `NoteCitation` first: `NoteCitation_noteId_fkey` is RESTRICT, so the
 *    join rows block the notes.
 * 2. `Note` before `Conversation`: `Note.originConversationId` references a
 *    conversation, and while it is `SetNull`, deleting the notes first keeps
 *    the delete from rewriting rows that are about to disappear anyway.
 * 3. `Notebook` is a `deleteMany`, not a `delete` — it is optional, and
 *    `delete` would throw `P2025` for a space that never had one.
 * 4. `Source` last before the space: `Passage` and `Citation` cascade off
 *    `sourceId`, so they need no statement of their own.
 *
 * One transaction, so a failure part-way leaves the space wholly intact rather
 * than stripped of its notes.
 */
const deleteWithChildren = async (id: string) => {
  await prisma.$transaction([
    prisma.noteCitation.deleteMany({
      where: { note: { researchSpaceId: id } }
    }),
    prisma.note.deleteMany({ where: { researchSpaceId: id } }),
    prisma.notebook.deleteMany({ where: { researchSpaceId: id } }),
    prisma.conversation.deleteMany({ where: { researchSpaceId: id } }),
    prisma.source.deleteMany({ where: { researchSpaceId: id } }),
    prisma.researchSpace.delete({ where: { id } })
  ]);
};

export default {
  findManyByOwner,
  findByIdAndOwner,
  findDetailByIdAndOwner,
  findByNameAndOwner,
  create,
  update,
  deleteWithChildren
};
