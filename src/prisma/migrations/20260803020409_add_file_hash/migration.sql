-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "fileHash" TEXT;

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
