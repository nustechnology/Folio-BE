-- Move the passage index to a 1024-dimension embedding space (bge-m3), and
-- rebuild the vector index as HNSW.
--
-- nomic-embed-text produced vectors that carried no usable signal for
-- non-Latin text: a query matching a passage word-for-word did not rank it
-- first, and every passage in a document sat within 0.09 cosine of every
-- other. Retrieval was therefore effectively random for Vietnamese sources.
--
-- Vectors from a different model are not comparable with these, so the stored
-- embeddings are not migrated — they are dropped, and every source that had
-- them is marked `failed` so it reappears as re-processable through the
-- existing retry endpoint. A source left `ready` with no passages would look
-- healthy while answering every question with "no evidence".

DROP INDEX IF EXISTS "Passage_embedding_idx";

-- `updatedAt` is set explicitly: Prisma's `@updatedAt` is applied by the client,
-- so raw SQL would leave these sources sorting by a stale timestamp even though
-- they just changed state.
UPDATE "Source" s
SET "processingState" = 'failed',
    "processingError" = 'Evidence index rebuilt for a new embedding model. Retry this source to re-index it.',
    "updatedAt" = NOW()
WHERE EXISTS (SELECT 1 FROM "Passage" p WHERE p."sourceId" = s."id");

-- The column type cannot widen over existing rows; they are unusable anyway.
DELETE FROM "Passage";

ALTER TABLE "Passage" ALTER COLUMN "embedding" TYPE vector(1024);

-- HNSW rather than IVFFlat, because this migration empties "Passage" before
-- creating the index. IVFFlat trains its centroids on the rows present at build
-- time, and at that point there are none: pgvector warns "ivfflat index created
-- with little data. This will cause low recall." Every passage re-ingested
-- afterwards would then be assigned against meaningless centroids, and at the
-- default `ivfflat.probes = 1` a query scans a single arbitrary list, returning
-- near-random neighbours — the exact failure this migration exists to fix.
--
-- HNSW builds its graph incrementally as rows arrive, so an index created ahead
-- of re-ingestion is still correct.
CREATE INDEX "Passage_embedding_idx" ON "Passage"
  USING hnsw ("embedding" vector_cosine_ops);
