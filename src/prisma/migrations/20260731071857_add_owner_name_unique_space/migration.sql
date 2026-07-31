-- CreateIndex
CREATE UNIQUE INDEX "ResearchSpace_ownerId_name_key" ON "ResearchSpace"("ownerId", LOWER("name"));
