-- AlterTable
ALTER TABLE `Game` ADD COLUMN `timeControlMs` INTEGER NULL,
    MODIFY `resultStatus` ENUM('checkmate', 'resigned', 'draw', 'abandoned', 'foul_loss', 'timeout') NULL;

