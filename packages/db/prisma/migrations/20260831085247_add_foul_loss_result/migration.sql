-- AlterTable
ALTER TABLE `Game` MODIFY `resultStatus` ENUM('checkmate', 'resigned', 'draw', 'abandoned', 'foul_loss') NULL;
