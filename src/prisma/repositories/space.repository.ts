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

// The cascade reaches `Passage`, which holds one embedding and one tsvector per
// chunk — a space of large PDFs is tens of thousands of wide rows, well past the
// 5s Prisma allows an interactive transaction by default.
const DELETE_TRANSACTION_TIMEOUT_MS = 60_000;
const DELETE_TRANSACTION_MAX_WAIT_MS = 10_000;

/**
 * Deletes a space and everything filed under it in one transaction, so a
 * failure part-way cannot leave a half-emptied space behind. Resolves `false`
 * when no space matched — an unknown id, or one owned by somebody else.
 *
 * The children are removed explicitly because none of the space relations
 * declare `onDelete: Cascade` — Postgres would reject the parent row. Order
 * matters twice over: sources are dropped first since a source promoted from a
 * note points back at it (`Source.originalNoteId`), and everything hanging off
 * a source (`Passage`, `Citation` → `NoteCitation`) does cascade, so those go
 * with it.
 */
const deleteByIdAndOwner = async (id: string, ownerId: string) => {
  return prisma.$transaction(
    async (tx) => {
      await tx.source.deleteMany({ where: { researchSpaceId: id } });
      // `NoteCitation.note` declares no referential action, so it restricts.
      // The source cascade above clears these in practice — every citation a
      // note holds is drawn from a source in the same space — but that is an
      // invariant of how answers are saved, not one the schema enforces, and a
      // single survivor would fail the notes below.
      await tx.noteCitation.deleteMany({
        where: { note: { researchSpaceId: id } }
      });
      await tx.note.deleteMany({ where: { researchSpaceId: id } });
      await tx.conversation.deleteMany({ where: { researchSpaceId: id } });
      await tx.notebook.deleteMany({ where: { researchSpaceId: id } });

      // Counted and owner-scoped rather than `delete`: a row already taken by a
      // concurrent delete would throw `P2025`, which nothing maps to a
      // response, and the predicate closes the window between the caller's
      // ownership check and this row going. A zero count rolls the children
      // back with it.
      const { count } = await tx.researchSpace.deleteMany({
        where: { id, ownerId }
      });
      return count > 0;
    },
    {
      timeout: DELETE_TRANSACTION_TIMEOUT_MS,
      maxWait: DELETE_TRANSACTION_MAX_WAIT_MS
    }
  );
};

export default {
  findManyByOwner,
  findByIdAndOwner,
  findDetailByIdAndOwner,
  findByNameAndOwner,
  create,
  deleteByIdAndOwner
};
