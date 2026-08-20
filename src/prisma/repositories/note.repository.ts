import { ListNotesOptions } from '~/api/types/note';
import { OriginType, Prisma } from '~/generated/prisma/client';
import prisma from '~/prisma/prisma.client';
import { escapeLikePattern } from '~/prisma/repositories/search.util';

const citationCountInclude = {
  _count: { select: { citationReferences: true } }
} satisfies Prisma.NoteInclude;

/**
 * A single note ships the evidence itself, not just how much of it there is:
 * the viewer resolves the `[n]` markers in the body against this list, so it
 * must arrive in the order the answer cited it. The source is joined for the
 * title/type/author the citation modal prints — the `Citation` row records only
 * the passage.
 */
/*
 * The secondary keys are what make the ordering deterministic for notes saved
 * before `position` existed: migration `20260811000000_add_note_citation_position`
 * left every one of their rows at the default `0`, and its claim that "their
 * markers resolve in insertion order" holds only if something breaks the tie —
 * Postgres is free to return equal keys in any order, so the same note could
 * print `[1]` and `[2]` against different evidence on consecutive reads.
 * `citation.createdAt` is the closest stand-in for insertion order the schema
 * kept; `citationId` settles rows written inside one transaction, where that
 * timestamp is identical.
 */
const citationDetailInclude = {
  ...citationCountInclude,
  citationReferences: {
    orderBy: [
      { position: 'asc' },
      { citation: { createdAt: 'asc' } },
      { citationId: 'asc' }
    ],
    include: {
      citation: {
        include: {
          source: {
            select: { id: true, title: true, sourceType: true, author: true }
          }
        }
      }
    }
  }
} satisfies Prisma.NoteInclude;

export type NoteRecord = Prisma.NoteGetPayload<{
  include: typeof citationCountInclude;
}>;

export type NoteDetailRecord = Prisma.NoteGetPayload<{
  include: typeof citationDetailInclude;
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

  if (options.origin !== 'all') {
    where.originType = options.origin;
  }

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
    include: citationDetailInclude
  });
};

const create = async (data: {
  researchSpaceId: string;
  title: string;
  content: string;
  contentText: string;
  originType: OriginType;
  originConversationId?: string;
  originMessageId?: string;
  /** Citation rows written when the answer was generated, in cited order. */
  citationIds?: string[];
}) => {
  const { citationIds = [], ...note } = data;

  return prisma.note.create({
    data: {
      ...note,
      citationReferences: {
        create: citationIds.map((citationId, position) => ({
          citationId,
          position
        }))
      }
    },
    include: citationDetailInclude
  });
};

/**
 * `contentText` always travels with `content` — search reads only the
 * projection, so letting the two drift would leave a note findable by wording
 * it no longer contains.
 *
 * Scoped by `researchSpaceId` as well as `id`: the write itself is what keeps a
 * note id from another space out, so no separate existence check has to stay
 * true between being read and being acted on. A row that is gone raises Prisma
 * `P2025`, which the service maps to `NOTE_NOT_FOUND`.
 */
const update = async (
  id: string,
  researchSpaceId: string,
  data: {
    title?: string;
    content?: string;
    contentText?: string;
  }
) => {
  return prisma.note.update({
    where: { id, researchSpaceId },
    data,
    include: citationDetailInclude
  });
};

/**
 * The join rows must go first: `NoteCitation_noteId_fkey` is `ON DELETE
 * RESTRICT`, so deleting a note that carries citations fails outright without
 * this. Dropping the joins discards only the note↔citation links — the
 * `Citation` rows belong to their source and survive.
 *
 * Sources converted from the note also survive, with their snapshotted content
 * intact: `Source_originalNoteId_fkey` is `ON DELETE SET NULL`, so the source
 * only loses its back-pointer. That is a schema-level guarantee, not something
 * this function arranges.
 *
 * Space-scoped and `P2025`-raising for the same reason as `update`.
 */
const remove = async (id: string, researchSpaceId: string) => {
  await prisma.$transaction([
    prisma.noteCitation.deleteMany({ where: { noteId: id } }),
    prisma.note.delete({ where: { id, researchSpaceId } })
  ]);
};

export default {
  findManyBySpace,
  findByIdInSpace,
  create,
  update,
  remove
};
