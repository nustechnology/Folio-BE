-- Widen the passage embedding from 768 to 1536 dimensions for
-- gemini-embedding-2. pgvector cannot cast a stored 768-d vector to 1536, and
-- vectors from a different model are not comparable anyway, so every passage
-- row is dropped.
--
-- !! RE-INDEX AFTERWARDS: `yarn reingest` !!
-- Until it finishes, sources read as `ready` but have no passages, so
-- retrieval and citations return nothing for them.

-- DropIndex (the ivfflat index is bound to the column's dimension)
DROP INDEX IF EXISTS "Passage_embedding_idx";

-- Drop the 768-d vectors so the column can change width
DELETE FROM "Passage";

-- AlterTable
ALTER TABLE "Passage" ALTER COLUMN "embedding" TYPE vector(1536);

-- Recreate index
CREATE INDEX "Passage_embedding_idx" ON "Passage"
  USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
