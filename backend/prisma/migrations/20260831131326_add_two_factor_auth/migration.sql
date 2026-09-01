-- AlterTable
ALTER TABLE "User" ADD COLUMN     "twoFactorBackupCodeHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twoFactorSecretEnc" TEXT;
