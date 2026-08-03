-- AlterTable: generated tsvector column for full-text search
ALTER TABLE "Passage" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

-- IVFFlat index for approximate cosine similarity search
CREATE INDEX "Passage_embedding_idx" ON "Passage"
  USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

-- GIN index for full-text search
CREATE INDEX "Passage_searchVector_idx" ON "Passage" USING GIN ("searchVector");
