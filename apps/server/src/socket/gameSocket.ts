import { Server, Socket } from "socket.io";
import { Move, Player } from "@shogi-games/rule-engine";
import { colorForToken, getGame, ServerGame } from "../gameManager";
import { serializeGame } from "../serialize";
import { chooseMove } from "../ai/simpleAi";
import { prisma } from "../db";
import { applyRatingUpdate } from "../rating";

const roomName = (gameId: string) => `game:${gameId}`;

const persistMove = async (game: ServerGame, player: Player, move: Move, capturedKind?: string) => {
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

const persistResultIfFinished = async (game: ServerGame) => {
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

const broadcastState = (io: Server, game: ServerGame) => {
  for (const color of ["sente", "gote"] as Player[]) {
    io.to(`${roomName(game.id)}:${color}`).emit("state", serializeGame(game, color));
  }
  io.to(`${roomName(game.id)}:spectator`).emit("state", serializeGame(game, null));
};

const maybeTriggerCpuMove = (io: Server, game: ServerGame) => {
  if (game.state.result.status !== "in_progress") return;
  const turn = game.state.turn;
  if (!game.cpuColors[turn]) return;

  setTimeout(async () => {
    const current = getGame(game.id);
    if (!current || current.state.result.status !== "in_progress") return;
    if (current.state.turn !== turn) return; // 二重発火防止(joinの再送信等で複数回スケジュールされた場合)
    const profile = current.aiConfig?.[turn];
    const move = chooseMove(current.state.board, current.state.hands, turn, current.ruleSet, {
      maxDepth: profile?.maxDepth,
      timeBudgetMs: profile?.timeBudgetMs,
    });
    if (!move) return;
    const capturedKind = current.state.board.get(move.to)?.kind;
    current.state.applyMove(move);
    await persistMove(current, turn, move, capturedKind);
    await persistResultIfFinished(current);
    broadcastState(io, current);
    maybeTriggerCpuMove(io, current);
  }, 400);
};

export const registerGameSocket = (io: Server) => {
  io.on("connection", (socket: Socket) => {
    socket.on("join", ({ gameId, playerToken }: { gameId: string; playerToken?: string }) => {
      const game = getGame(gameId);
      if (!game) {
        socket.emit("error", { message: "game_not_found" });
        return;
      }

      const color = playerToken ? colorForToken(game, playerToken) : null;
      socket.join(color ? `${roomName(gameId)}:${color}` : `${roomName(gameId)}:spectator`);
      socket.emit("state", serializeGame(game, color));
      maybeTriggerCpuMove(io, game);
    });

    socket.on(
      "move",
      async ({ gameId, playerToken, move }: { gameId: string; playerToken: string; move: Move }) => {
        const game = getGame(gameId);
        if (!game) {
          socket.emit("error", { message: "game_not_found" });
          return;
        }

        const color = colorForToken(game, playerToken);
        if (!color) {
          socket.emit("error", { message: "invalid_token" });
          return;
        }
        if (game.state.turn !== color) {
          socket.emit("error", { message: "not_your_turn" });
          return;
        }
        if (game.state.result.status !== "in_progress") {
          socket.emit("error", { message: "game_finished" });
          return;
        }

        const legal = game.state.legalMoves(color);
        const matched = legal.find(
          (m) =>
            m.type === move.type &&
            m.to.row === move.to.row &&
            m.to.col === move.to.col &&
            m.piece === move.piece &&
            !!m.promote === !!move.promote &&
            (m.type === "drop" || (m.from?.row === move.from?.row && m.from?.col === move.from?.col))
        );
        if (!matched) {
          socket.emit("error", { message: "illegal_move" });
          return;
        }

        const capturedKind = game.state.board.get(matched.to)?.kind;
        game.state.applyMove(matched);
        await persistMove(game, color, matched, capturedKind);
        await persistResultIfFinished(game);
        broadcastState(io, game);
        maybeTriggerCpuMove(io, game);
      }
    );

    socket.on("resign", async ({ gameId, playerToken }: { gameId: string; playerToken: string }) => {
      const game = getGame(gameId);
      if (!game) return;
      const color = colorForToken(game, playerToken);
      if (!color || game.state.result.status !== "in_progress") return;

      game.state.resign(color);
      await persistResultIfFinished(game);
      broadcastState(io, game);
    });
  });
};
