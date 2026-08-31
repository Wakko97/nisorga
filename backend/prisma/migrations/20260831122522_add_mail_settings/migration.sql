-- AlterTable
ALTER TABLE "AppState" ADD COLUMN     "emailInboundDomain" TEXT,
ADD COLUMN     "imapHost" TEXT,
ADD COLUMN     "imapMailbox" TEXT,
ADD COLUMN     "imapPasswordEnc" TEXT,
ADD COLUMN     "imapPort" INTEGER,
ADD COLUMN     "imapSecure" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "imapUser" TEXT,
ADD COLUMN     "smtpFromEmail" TEXT,
ADD COLUMN     "smtpHost" TEXT,
ADD COLUMN     "smtpPasswordEnc" TEXT,
ADD COLUMN     "smtpPort" INTEGER,
ADD COLUMN     "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smtpUser" TEXT;
