import { ListNotesOptions } from '~/api/types/note';
import { OriginType, Prisma } from '~/generated/prisma/client';
import prisma from '~/prisma/prisma.client';
import { escapeLikePattern } from '~/prisma/repositories/search.util';

const citationCountInclude = {
  _count: { select: { citationReferences: true } }
} satisfies Prisma.NoteInclude;

export type NoteRecord = Prisma.NoteGetPayload<{
  include: typeof citationCountInclude;
}>;

const sortOrderMap: Record<
  ListNotesOptions['sort'],
  Prisma.NoteOrderByWithRelationInput
> = {
  'recently-updated': { updatedAt: 'desc' },
  'recently-created': { createdAt: 'desc' },
  'alphabetical-az': { title: 'asc' },
  'alphabetical-za': { title: 'desc' }
};

const findManyBySpace = async (
  researchSpaceId: string,
  options: ListNotesOptions
) => {
  const where: Prisma.NoteWhereInput = { researchSpaceId };

  /**
   * Searching `contentText` rather than `content` keeps tag names out of the
   * match: against the markup, `?search=p` or `?search=blank` would hit every
   * note that has a paragraph or a link.
   */
  if (options.search) {
    const search = escapeLikePattern(options.search);
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { contentText: { contains: search, mode: 'insensitive' } }
    ];
  }

  const [notes, totalCount] = await Promise.all([
    prisma.note.findMany({
      where,
      include: citationCountInclude,
      orderBy: sortOrderMap[options.sort],
      skip: (options.page - 1) * options.limit,
      take: options.limit
    }),
    prisma.note.count({ where })
  ]);

  return { notes, totalCount };
};

const findByIdInSpace = async (id: string, researchSpaceId: string) => {
  return prisma.note.findFirst({
    where: { id, researchSpaceId },
    include: citationCountInclude
  });
};

const create = async (data: {
  researchSpaceId: string;
  title: string;
  content: string;
  contentText: string;
  originType: OriginType;
}) => {
  return prisma.note.create({ data, include: citationCountInclude });
};

export default {
  findManyBySpace,
  findByIdInSpace,
  create
};
