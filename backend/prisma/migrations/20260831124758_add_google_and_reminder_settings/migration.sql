-- AlterTable
ALTER TABLE "AppState" ADD COLUMN     "googleClientId" TEXT,
ADD COLUMN     "googleClientSecretEnc" TEXT,
ADD COLUMN     "googleRedirectUri" TEXT,
ADD COLUMN     "waitingReminderDays" INTEGER;
