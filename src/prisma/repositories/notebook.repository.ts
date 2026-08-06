import prisma from '~/prisma/prisma.client';

const findBySpace = async (researchSpaceId: string) => {
  return prisma.notebook.findUnique({ where: { researchSpaceId } });
};

/**
 * Keyed on the `researchSpaceId` unique constraint, which is what makes two
 * concurrent first saves safe: one inserts, the other's insert violates the
 * constraint and is retried as an update. A find-then-create would answer
 * `500` to the loser instead.
 */
const upsert = async (researchSpaceId: string, content: string) => {
  return prisma.notebook.upsert({
    where: { researchSpaceId },
    create: { researchSpaceId, content },
    update: { content }
  });
};

export default {
  findBySpace,
  upsert
};
