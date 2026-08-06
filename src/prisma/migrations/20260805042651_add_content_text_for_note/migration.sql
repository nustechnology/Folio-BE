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
-- the two `regexp_replace` calls stand in for JavaScript's `String.trim`. They
-- also match U+00A0, which JavaScript's trim treats as whitespace but Postgres'
-- `\s` does not — interior no-break spaces are left alone, as in `toPlainText`.
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
  chr(13) || chr(10), chr(10)),
  '^[\s\u00a0]+', ''),
  '[\s\u00a0]+$', ''
);
