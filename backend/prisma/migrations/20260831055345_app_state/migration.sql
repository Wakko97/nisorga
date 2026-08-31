-- CreateTable
CREATE TABLE "AppState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "initialized" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AppState_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row. index.ts also upserts this defensively on every
-- boot (belt-and-suspenders in case the row is ever lost), but seeding it
-- here means it exists immediately once this migration is applied, without
-- waiting for the app to start.
INSERT INTO "AppState" (id, initialized) VALUES (1, false) ON CONFLICT (id) DO NOTHING;
