-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "contentText" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "Citation_sourceId_idx" ON "Citation"("sourceId");

-- CreateIndex
CREATE INDEX "Conversation_researchSpaceId_idx" ON "Conversation"("researchSpaceId");

-- CreateIndex
CREATE INDEX "Note_researchSpaceId_idx" ON "Note"("researchSpaceId");

-- CreateIndex
CREATE INDEX "Note_originConversationId_idx" ON "Note"("originConversationId");

-- CreateIndex
CREATE INDEX "NoteCitation_citationId_idx" ON "NoteCitation"("citationId");

-- CreateIndex
CREATE INDEX "ResearchSpace_ownerId_idx" ON "ResearchSpace"("ownerId");

-- CreateIndex
CREATE INDEX "Source_researchSpaceId_idx" ON "Source"("researchSpaceId");

-- CreateIndex
CREATE INDEX "Source_originalNoteId_idx" ON "Source"("originalNoteId");


-- Backfill: mirror `toPlainText` in ~/api/utils/rich-text.util.ts —
-- `</p>`, `</li>` and `<br>` become newlines, remaining tags are stripped, then
-- entities are decoded with `&amp;` resolved last so `&amp;lt;` cannot decode
-- twice into a tag.
-- `btrim` would only strip spaces; the trailing block boundary is a newline, so
-- the two `regexp_replace` calls stand in for JavaScript's `String.trim`. The
-- `chr(160)` pass is part of that: sanitization leaves `&nbsp;` as a literal
-- no-break space, which JavaScript's `\s` trims but Postgres' does not.
UPDATE "Note"
SET "contentText" = regexp_replace(
  regexp_replace(
  replace(
  replace(
    replace(
      replace(
        replace(
          replace(
            replace(
              replace(
                regexp_replace(
                  regexp_replace("content", '</(p|li)>|<br\s*/?>', chr(10), 'gi'),
                  '<[^>]*>', '', 'g'
                ),
                '&lt;', '<'
              ),
              '&gt;', '>'
            ),
            '&quot;', '"'
          ),
          '&#39;', ''''
        ),
        '&apos;', ''''
      ),
      '&nbsp;', ' '
    ),
    '&amp;', '&'
  ),
  chr(160), ' '),
  '^\s+', ''),
  '\s+$', ''
);
