-- DropIndex
DROP INDEX IF EXISTS "Passage_embedding_idx";

-- AlterTable
ALTER TABLE "Passage" ALTER COLUMN "embedding" TYPE vector(768);

-- AlterColumn (generated columns cannot have drop default)
ALTER TABLE "Passage" ALTER COLUMN "searchVector" SET NOT NULL;

-- Recreate index
CREATE INDEX "Passage_embedding_idx" ON "Passage"
  USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
