import { GameState, Move, Player, RuleSet } from "@shogi-games/rule-engine";
import { GameMode, ServerGame, registerRestoredGame } from "./gameManager";
import { prisma } from "./db";
import { getAiProfileByUserId } from "./aiProfiles";

/** サーバー起動時、DBに保存されている進行中の対局(status=in_progress)を指し手履歴から再生して
 * in-memoryのServerGameストアに復元する。プライベートマッチで相手がまだ来ていない(status=waiting)対局は
 * ルームコードだけ有効なままにしたいので、こちらも合わせて復元する。 */
export const restoreGamesFromDb = async (): Promise<void> => {
  const dbGames = await prisma.game.findMany({
    where: { status: { in: ["in_progress", "waiting"] } },
    include: { ruleSetPreset: true, moves: { orderBy: { moveNumber: "asc" } } },
  });

  let restored = 0;
  for (const dbGame of dbGames) {
    try {
      const ruleSet = dbGame.ruleSetPreset.config as unknown as RuleSet;
      const state = new GameState(ruleSet);

      for (const m of dbGame.moves) {
        const move: Move =
          m.moveType === "move"
            ? {
                type: "move",
                from: { row: m.fromRow!, col: m.fromCol! },
                to: { row: m.toRow, col: m.toCol },
                piece: m.piece,
                promote: m.promote,
              }
            : { type: "drop", to: { row: m.toRow, col: m.toCol }, piece: m.piece };
        state.applyMove(move);
      }

      if (state.result.status !== "in_progress") {
        // 保存されていた指し手だけで既に決着している(通常は起こらないはずだが、念のためのガード)。
        continue;
      }

      const userIds: Partial<Record<Player, string>> = {
        ...(dbGame.senteUserId ? { sente: dbGame.senteUserId } : {}),
        ...(dbGame.goteUserId ? { gote: dbGame.goteUserId } : {}),
      };
      const senteAiProfile = dbGame.isSenteCpu && dbGame.senteUserId ? getAiProfileByUserId(dbGame.senteUserId) : undefined;
      const goteAiProfile = dbGame.isGoteCpu && dbGame.goteUserId ? getAiProfileByUserId(dbGame.goteUserId) : undefined;

      const game: ServerGame = {
        id: dbGame.engineGameId,
        mode: dbGame.mode as GameMode,
        ruleSet,
        state,
        tokens: {
          ...(dbGame.senteToken ? { sente: dbGame.senteToken } : {}),
          ...(dbGame.goteToken ? { gote: dbGame.goteToken } : {}),
        },
        cpuColors: {
          ...(dbGame.isSenteCpu ? { sente: true } : {}),
          ...(dbGame.isGoteCpu ? { gote: true } : {}),
        },
        aiConfig: {
          ...(senteAiProfile ? { sente: senteAiProfile } : {}),
          ...(goteAiProfile ? { gote: goteAiProfile } : {}),
        },
        userIds,
        roomCode: dbGame.roomCode ?? undefined,
        dbGameId: dbGame.id,
        createdAt: dbGame.createdAt.getTime(),
      };

      registerRestoredGame(game);
      restored++;
    } catch (e) {
      console.error(`failed to restore game ${dbGame.id} (engineGameId=${dbGame.engineGameId}):`, e);
    }
  }

  if (restored > 0) console.log(`restored ${restored} in-progress game(s) from database`);
};
