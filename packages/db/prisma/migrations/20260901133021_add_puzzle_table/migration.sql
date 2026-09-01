-- CreateTable
CREATE TABLE `Puzzle` (
    `id` VARCHAR(191) NOT NULL,
    `ruleSetPresetId` VARCHAR(191) NOT NULL,
    `snapshot` JSON NOT NULL,
    `solutionMoves` JSON NOT NULL,
    `mateLength` INTEGER NOT NULL,
    `sourceGameId` VARCHAR(191) NULL,
    `occurrenceCount` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Puzzle_mateLength_idx`(`mateLength`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Puzzle` ADD CONSTRAINT `Puzzle_ruleSetPresetId_fkey` FOREIGN KEY (`ruleSetPresetId`) REFERENCES `RuleSetPreset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

