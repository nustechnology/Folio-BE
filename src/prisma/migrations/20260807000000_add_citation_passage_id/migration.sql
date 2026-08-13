-- AlterTable
-- Passage a citation was drawn from. Intentionally not a foreign key: the
-- ingestion pipeline replaces a source's passages on every (re-)run, and a
-- citation saved into a note has to survive that.
ALTER TABLE "Citation" ADD COLUMN     "passageId" TEXT;
