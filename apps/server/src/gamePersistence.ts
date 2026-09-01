import { Move, Player } from "@shogi-games/rule-engine";
import { ServerGame } from "./gameManager";
import { prisma } from "./db";
import { applyRatingUpdate } from "./rating";

/** 対局の指し手をDBに永続化する。gameSocket.ts(通常対局)とselfPlay.ts(自己対局バッチ)の両方から使う共通処理。 */
export const persistMove = async (
  game: ServerGame,
  player: Player,
  move: Move,
  capturedKind?: string
): Promise<void> => {
  if (!game.dbGameId) return;
  const moveNumber = game.state.history.length;
  await prisma.gameMove.create({
    data: {
      gameId: game.dbGameId,
      moveNumber,
      player,
      moveType: move.type,
      fromRow: move.from?.row ?? null,
      fromCol: move.from?.col ?? null,
      toRow: move.to.row,
      toCol: move.to.col,
      piece: move.piece,
      promote: !!move.promote,
      capturedPiece: capturedKind ?? null,
    },
  });
};

/** 対局が終了していればDBの結果を確定し、両陣営がUserアカウントに紐づいていればレーティングを更新する。 */
export const persistResultIfFinished = async (game: ServerGame): Promise<void> => {
  if (!game.dbGameId) return;
  const { result } = game.state;
  if (result.status === "in_progress") return;

  await prisma.game.update({
    where: { id: game.dbGameId },
    data: {
      status: "finished",
      resultStatus:
        result.status === "checkmate" || result.status === "resigned" || result.status === "foul_loss"
          ? result.status
          : "draw",
      winner: "winner" in result ? result.winner : null,
      endedAt: new Date(),
    },
  });

  const { sente: senteUserId, gote: goteUserId } = game.userIds;
  if (senteUserId && goteUserId) {
    const senteScore = !("winner" in result) ? 0.5 : result.winner === "sente" ? 1 : 0;
    await applyRatingUpdate({ senteUserId, goteUserId, senteScore }).catch((e) =>
      console.error("rating update failed", e)
    );
  }
};
