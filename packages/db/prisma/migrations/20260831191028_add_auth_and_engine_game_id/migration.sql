-- AlterTable
ALTER TABLE `Game` ADD COLUMN `engineGameId` VARCHAR(191) NOT NULL,
    ADD COLUMN `goteToken` VARCHAR(191) NULL,
    ADD COLUMN `senteToken` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `gamesPlayed` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `isAi` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `passwordHash` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Game_engineGameId_key` ON `Game`(`engineGameId`);

-- CreateIndex
CREATE INDEX `User_isAi_idx` ON `User`(`isAi`);

