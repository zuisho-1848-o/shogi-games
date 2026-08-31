-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `rating` INTEGER NOT NULL DEFAULT 1500,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RuleSetPreset` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `config` JSON NOT NULL,
    `isPublic` BOOLEAN NOT NULL DEFAULT true,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Game` (
    `id` VARCHAR(191) NOT NULL,
    `mode` ENUM('cpu', 'private', 'casual', 'randomMatch') NOT NULL,
    `ruleSetPresetId` VARCHAR(191) NOT NULL,
    `senteUserId` VARCHAR(191) NULL,
    `goteUserId` VARCHAR(191) NULL,
    `isSenteCpu` BOOLEAN NOT NULL DEFAULT false,
    `isGoteCpu` BOOLEAN NOT NULL DEFAULT false,
    `roomCode` VARCHAR(191) NULL,
    `status` ENUM('waiting', 'in_progress', 'finished') NOT NULL DEFAULT 'waiting',
    `resultStatus` ENUM('checkmate', 'resigned', 'draw', 'abandoned') NULL,
    `winner` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NULL,
    `endedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Game_roomCode_key`(`roomCode`),
    INDEX `Game_status_idx`(`status`),
    INDEX `Game_roomCode_idx`(`roomCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GameMove` (
    `id` VARCHAR(191) NOT NULL,
    `gameId` VARCHAR(191) NOT NULL,
    `moveNumber` INTEGER NOT NULL,
    `player` VARCHAR(191) NOT NULL,
    `moveType` VARCHAR(191) NOT NULL,
    `fromRow` INTEGER NULL,
    `fromCol` INTEGER NULL,
    `toRow` INTEGER NOT NULL,
    `toCol` INTEGER NOT NULL,
    `piece` VARCHAR(191) NOT NULL,
    `promote` BOOLEAN NOT NULL DEFAULT false,
    `capturedPiece` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GameMove_gameId_idx`(`gameId`),
    UNIQUE INDEX `GameMove_gameId_moveNumber_key`(`gameId`, `moveNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RuleSetPreset` ADD CONSTRAINT `RuleSetPreset_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Game` ADD CONSTRAINT `Game_ruleSetPresetId_fkey` FOREIGN KEY (`ruleSetPresetId`) REFERENCES `RuleSetPreset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Game` ADD CONSTRAINT `Game_senteUserId_fkey` FOREIGN KEY (`senteUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Game` ADD CONSTRAINT `Game_goteUserId_fkey` FOREIGN KEY (`goteUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GameMove` ADD CONSTRAINT `GameMove_gameId_fkey` FOREIGN KEY (`gameId`) REFERENCES `Game`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
