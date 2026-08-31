-- CreateEnum
CREATE TYPE "WebhookFormat" AS ENUM ('GENERIC', 'SLACK');

-- AlterTable
ALTER TABLE "WebhookSubscription" ADD COLUMN     "format" "WebhookFormat" NOT NULL DEFAULT 'GENERIC';
