import prisma from '~/prisma/prisma.client';

export type NewPassage = {
  sourceId: string;
  content: string;
  embedding: number[];
  tokenCount: number;
  strategyVersion: string;
  locator: unknown;
};

// Replace a source's passages atomically: delete every existing row for the
// source, then insert the supplied passages — all in one transaction. Also
// handles the zero-passages case (a re-ingested source that now yields no
// passages still gets its stale rows removed). Uses raw SQL because Prisma
// cannot write the `Unsupported("vector(768)")` embedding column via the normal
// client API — each vector is serialized as a Postgres literal
// (`'[...]'::vector`).
const replaceBySourceId = async (
  sourceId: string,
  passages: NewPassage[]
): Promise<void> => {
  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM "Passage" WHERE "sourceId" = ${sourceId}`,
    ...passages.map(
      (p) =>
        prisma.$executeRaw`
        INSERT INTO "Passage" ("id", "sourceId", "content", "embedding", "tokenCount", "strategyVersion", "locator")
        VALUES (gen_random_uuid(), ${p.sourceId}, ${p.content}, ${JSON.stringify(p.embedding)}::vector, ${p.tokenCount}, ${p.strategyVersion}, ${JSON.stringify(p.locator)}::jsonb)
      `
    )
  ]);
};

// Delete all passages of a source. Note: the Source FK has ON DELETE CASCADE,
// so this is only needed for explicit cleanup outside a source deletion.
const deleteBySourceId = async (sourceId: string): Promise<void> => {
  await prisma.passage.deleteMany({ where: { sourceId } });
};

export default {
  replaceBySourceId,
  deleteBySourceId
};
