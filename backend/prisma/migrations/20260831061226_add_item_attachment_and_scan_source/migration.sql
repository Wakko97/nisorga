-- AlterEnum
ALTER TYPE "ItemSource" ADD VALUE 'SCAN';

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "attachmentPath" TEXT;
