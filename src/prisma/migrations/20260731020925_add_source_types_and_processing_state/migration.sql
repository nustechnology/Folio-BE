/*
  Warnings:

  - You are about to drop the column `originalFileUrl` on the `Source` table. All the data in the column will be lost.
  - The `processingState` column on the `Source` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `sourceType` on the `Source` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('File', 'Web', 'Manual');

-- CreateEnum
CREATE TYPE "ProcessingState" AS ENUM ('added', 'extracting_text', 'indexing_evidence', 'ready', 'failed');

-- AlterTable
ALTER TABLE "Source" DROP COLUMN "originalFileUrl",
ADD COLUMN     "characterCount" INTEGER,
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "fileSize" BIGINT,
ADD COLUMN     "fileType" TEXT,
ADD COLUMN     "pageCount" INTEGER,
ADD COLUMN     "processingError" TEXT,
ADD COLUMN     "sourceUrl" TEXT,
DROP COLUMN "sourceType",
ADD COLUMN     "sourceType" "SourceType" NOT NULL,
DROP COLUMN "processingState",
ADD COLUMN     "processingState" "ProcessingState" NOT NULL DEFAULT 'added';
