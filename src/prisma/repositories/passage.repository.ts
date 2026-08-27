import { Prisma, SourceType } from '~/generated/prisma/client';
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
// cannot write the `Unsupported("vector(1024)")` embedding column via the normal
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

// pgvector stores the dimension count in the column's typmod, so this detects a
// schema that hasn't caught up with MODEL_EMBEDDING_DIMENSIONS.
const getEmbeddingDimensions = async (): Promise<number> => {
  const rows = await prisma.$queryRaw<{ dimensions: number }[]>`
    SELECT atttypmod AS dimensions
    FROM pg_attribute
    WHERE attrelid = '"Passage"'::regclass AND attname = 'embedding'
  `;
  return Number(rows[0]?.dimensions ?? 0);
};

const countBySourceId = async (sourceId: string): Promise<number> => {
  return prisma.passage.count({ where: { sourceId } });
};

const findByIdAndSourceId = async (id: string, sourceId: string) => {
  return prisma.passage.findFirst({
    where: { id, sourceId }
  });
};

// Backs the source reader's citation deep-link (`#evidence-passage-<id>`).
const findById = async (id: string) => {
  return prisma.passage.findUnique({
    where: { id }
  });
};

export type PassageLocator = {
  blockRange?: [number, number];
  headingPath?: string[];
  firstOrder?: number;
  lastOrder?: number;
};

export type RetrievedPassage = {
  id: string;
  sourceId: string;
  content: string;
  locator: PassageLocator | null;
  sourceTitle: string;
  sourceType: SourceType;
  sourceAuthor: string | null;
  sourceFileName: string | null;
  sourceFileType: string | null;
  score: number;
};

export type HybridSearchOptions = {
  researchSpaceId: string;
  /** Restricts retrieval to a single document (the "current source" scope). */
  sourceId?: string;
  embedding: number[];
  query: string;
  candidates: number;
  limit: number;
};

// Hybrid retrieval over a space's indexed evidence.
//
// Two independent rankings are computed — nearest neighbours by cosine distance
// on the passage embedding, and Postgres full-text rank on the generated
// `searchVector` — then merged with Reciprocal Rank Fusion. RRF needs no score
// normalization between the two (their scales are unrelated) and rewards
// passages that both branches agree on, which is what makes a hybrid worth the
// second query: vectors catch paraphrase, full text catches proper nouns and
// numbers the embedding blurs away.
//
// Only `ready` sources are searched — anything else has no complete index yet.
const RRF_K = 60;

const searchHybrid = async (
  options: HybridSearchOptions
): Promise<RetrievedPassage[]> => {
  const { researchSpaceId, sourceId, embedding, query, candidates, limit } =
    options;

  // An empty embedding would build the literal `[]`, which Postgres rejects as a
  // `vector` (it needs at least one dimension) and would fail the whole query.
  if (embedding.length === 0) {
    return [];
  }

  const sourceFilter = sourceId
    ? Prisma.sql`AND p."sourceId" = ${sourceId}`
    : Prisma.empty;

  const vector = `[${embedding.join(',')}]`;
  // Inlined rather than bound: as a parameter, Postgres cannot infer a type for
  // `$n + rank` and the fusion arithmetic fails to plan.
  const rrfK = Prisma.raw(String(RRF_K));

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      sourceId: string;
      content: string;
      locator: PassageLocator | null;
      sourceTitle: string;
      sourceType: SourceType;
      sourceAuthor: string | null;
      sourceFileName: string | null;
      sourceFileType: string | null;
      score: number;
    }>
  >`
    WITH semantic AS (
      SELECT id, ROW_NUMBER() OVER () AS rank
      FROM (
        SELECT p."id" AS id
        FROM "Passage" p
        JOIN "Source" s ON s."id" = p."sourceId"
        WHERE s."researchSpaceId" = ${researchSpaceId}
          AND s."processingState" = 'ready'
          ${sourceFilter}
        ORDER BY p."embedding" <=> ${vector}::vector
        LIMIT ${candidates}
      ) ranked
    ),
    lexical AS (
      SELECT id, ROW_NUMBER() OVER () AS rank
      FROM (
        SELECT p."id" AS id
        FROM "Passage" p
        JOIN "Source" s ON s."id" = p."sourceId"
        WHERE s."researchSpaceId" = ${researchSpaceId}
          AND s."processingState" = 'ready'
          ${sourceFilter}
          AND p."searchVector" @@ websearch_to_tsquery('english', ${query})
        ORDER BY ts_rank_cd(p."searchVector", websearch_to_tsquery('english', ${query})) DESC
        LIMIT ${candidates}
      ) ranked
    ),
    fused AS (
      SELECT COALESCE(semantic.id, lexical.id) AS id,
             COALESCE(1.0 / (${rrfK} + semantic.rank), 0)
               + COALESCE(1.0 / (${rrfK} + lexical.rank), 0) AS score
      FROM semantic
      FULL OUTER JOIN lexical ON lexical.id = semantic.id
    )
    SELECT p."id",
           p."sourceId",
           p."content",
           p."locator",
           s."title"    AS "sourceTitle",
           s."sourceType" AS "sourceType",
           s."author"   AS "sourceAuthor",
           s."fileName" AS "sourceFileName",
           s."fileType" AS "sourceFileType",
           fused.score::float8 AS score
    FROM fused
    JOIN "Passage" p ON p."id" = fused.id
    JOIN "Source" s ON s."id" = p."sourceId"
    ORDER BY fused.score DESC
    LIMIT ${limit}
  `;

  return rows;
};

// Passages of one source, in reading order, for the reader's citation
// highlight. `embedding`/`searchVector` are deliberately left out — they are
// large, unrepresentable in Prisma's types, and of no use to a client.
const findBySourceId = async (sourceId: string) => {
  const passages = await prisma.passage.findMany({
    where: { sourceId },
    select: { id: true, content: true, locator: true, tokenCount: true }
  });

  const order = (locator: unknown): number => {
    const value = (locator as PassageLocator | null)?.firstOrder;
    return typeof value === 'number' ? value : Number.MAX_SAFE_INTEGER;
  };

  return passages.sort((a, b) => order(a.locator) - order(b.locator));
};

const countBySpaceId = async (researchSpaceId: string): Promise<number> => {
  return prisma.passage.count({
    where: { source: { researchSpaceId, processingState: 'ready' } }
  });
};

export default {
  replaceBySourceId,
  deleteBySourceId,
  getEmbeddingDimensions,
  countBySourceId,
  findByIdAndSourceId,
  findById,
  searchHybrid,
  findBySourceId,
  countBySpaceId
};
