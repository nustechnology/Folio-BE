import prisma from '~/prisma/prisma.client';

export type NewPassage = {
  sourceId: string;
  content: string;
  embedding: number[];
  tokenCount: number;
  strategyVersion: string;
  locator: unknown;
};

// Insert a batch of passages. Uses raw SQL because Prisma cannot write the
// `Unsupported("vector(1536)")` column via the normal client API — the embedding
// array is serialized to Postgres's vector literal (`'[...]'::vector`). All
// inserts run in one transaction so a failure leaves no partial passages.
const createMany = async (passages: NewPassage[]): Promise<void> => {
  if (passages.length === 0) {
    return;
  }

  await prisma.$transaction(
    passages.map(
      (p) =>
        prisma.$executeRaw`
        INSERT INTO "Passage" ("id", "sourceId", "content", "embedding", "tokenCount", "strategyVersion", "locator")
        VALUES (gen_random_uuid(), ${p.sourceId}, ${p.content}, ${JSON.stringify(p.embedding)}::vector, ${p.tokenCount}, ${p.strategyVersion}, ${JSON.stringify(p.locator)}::jsonb)
      `
    )
  );
};

// Delete all passages of a source. Note: the Source FK has ON DELETE CASCADE,
// so this is only needed for explicit cleanup outside a source deletion.
const deleteBySourceId = async (sourceId: string): Promise<void> => {
  await prisma.passage.deleteMany({ where: { sourceId } });
};

export default {
  createMany,
  deleteBySourceId
};
