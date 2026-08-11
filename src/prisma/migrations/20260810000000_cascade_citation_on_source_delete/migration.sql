-- Deleting a source failed with `Citation_sourceId_fkey` once the Ask pipeline
-- started writing Citation rows: `Passage` already cascaded but `Citation` was
-- left at the default RESTRICT.
--
-- A citation belongs to its source (see specs/notes/spec.md: citations survive
-- the *note* that references them, "they belong to their source, not to the
-- note"), so it goes when the source goes — and the NoteCitation join rows go
-- with it, or they would block the cascade.
--
-- `NoteCitation_noteId_fkey` is deliberately left RESTRICT: deleting a note
-- must still clear its join rows explicitly, in the note's own transaction.

-- DropForeignKey
ALTER TABLE "Citation" DROP CONSTRAINT "Citation_sourceId_fkey";

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "NoteCitation" DROP CONSTRAINT "NoteCitation_citationId_fkey";

-- AddForeignKey
ALTER TABLE "NoteCitation" ADD CONSTRAINT "NoteCitation_citationId_fkey" FOREIGN KEY ("citationId") REFERENCES "Citation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
