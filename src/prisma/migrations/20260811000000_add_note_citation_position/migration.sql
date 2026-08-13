-- AlterTable
-- Notes saved before this column existed keep position 0 on every row: the
-- order they were cited in was never recorded, so there is nothing to backfill
-- from. Their markers resolve in insertion order, which is the best available.
ALTER TABLE "NoteCitation" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;
