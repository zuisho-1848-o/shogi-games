import { Server, Socket } from "socket.io";
import { Move, Player } from "@shogi-games/rule-engine";
import { colorForToken, consumeTurnTimeAndCheckTimeout, getGame, ServerGame } from "../gameManager";
import { serializeGame } from "../serialize";
import { chooseMoveForProfile } from "../ai/chooseMoveForProfile";
import { getAiProfileBySlug } from "../aiProfiles";
import { persistMove, persistResultIfFinished } from "../gamePersistence";
import { checkSocketRateLimit, clearSocketRateLimit } from "../rateLimit";

const roomName = (gameId: string) => `game:${gameId}`;
const MOVE_RATE_LIMIT = 120; // 1分あたりの最大着手回数(人間には十分すぎる余裕、暴走ボット対策)
const MOVE_RATE_WINDOW_MS = 60 * 1000;

const broadcastState = (io: Server, game: ServerGame) => {
  for (const color of ["sente", "gote"] as Player[]) {
    io.to(`${roomName(game.id)}:${color}`).emit("state", serializeGame(game, color));
  }
  io.to(`${roomName(game.id)}:spectator`).emit("state", serializeGame(game, null));
};

/** 持ち時間切れを検出したら決着させ、DBに反映してブロードキャストする。時間切れならtrueを返す。 */
const applyTimeoutIfExpired = async (io: Server, game: ServerGame): Promise<boolean> => {
  const timedOutPlayer = consumeTurnTimeAndCheckTimeout(game);
  if (!timedOutPlayer) return false;

  game.state.timeout(timedOutPlayer);
  await persistResultIfFinished(game);
  broadcastState(io, game);
  return true;
};

const maybeTriggerCpuMove = (io: Server, game: ServerGame) => {
  if (game.state.result.status !== "in_progress") return;
  const turn = game.state.turn;
  if (!game.cpuColors[turn]) return;

  setTimeout(async () => {
    try {
      const current = getGame(game.id);
      if (!current || current.state.result.status !== "in_progress") return;
      if (current.state.turn !== turn) return; // 二重発火防止(joinの再送信等で複数回スケジュールされた場合)
      // aiConfigに明示指定がなければ既定強さ(ai_medium相当)にフォールバックする。
      const profile = current.aiConfig?.[turn] ?? getAiProfileBySlug("ai_medium") ?? {
        slug: "ai_medium",
        name: "AI中級",
        maxDepth: 4,
        timeBudgetMs: 1200,
      };
      const move = await chooseMoveForProfile(current.state.board, current.state.hands, turn, current.ruleSet, profile, {
        moveCountSoFar: current.state.history.length,
      });
      if (!move) return;
      const capturedKind = current.state.board.get(move.to)?.kind;
      current.state.applyMove(move);
      await persistMove(current, turn, move, capturedKind);
      await persistResultIfFinished(current);
      broadcastState(io, current);
      maybeTriggerCpuMove(io, current);
      maybeScheduleTimeout(io, current);
    } catch (e) {
      // 外部USIエンジンのクラッシュ/タイムアウト等でCPU側が手を指せなくても、プロセス全体を落とさない。
      // (以前は例外がここで無視されずsetTimeoutコールバック内でunhandled rejectionになり、サーバー全体がクラッシュしていた)
      console.error(`[maybeTriggerCpuMove] failed to produce a CPU move for game ${game.id}:`, e);
    }
  }, 400);
};

/** 持ち時間制の対局で、現在の手番側の残り時間がちょうど尽きるタイミングにタイマーを仕込んでおく。
 * 誰も着手しないまま持ち時間が切れた場合でも、このタイマーが自発的に時間切れを成立させる。
 * (人間側の着手時にもconsumeTurnTimeAndCheckTimeoutで同様のチェックをしているので、二重に処理されても
 * 2回目はgame.state.result.statusが既にin_progressでなくなっているため無害。) */
const maybeScheduleTimeout = (io: Server, game: ServerGame) => {
  if (game.state.result.status !== "in_progress" || !game.timeControl) return;
  const turn = game.state.turn;
  const remaining = game.timeControl.remainingMs[turn];

  setTimeout(async () => {
    const current = getGame(game.id);
    if (!current || current.state.result.status !== "in_progress") return;
    if (current.state.turn !== turn) return; // その間に着手されていれば何もしない
    await applyTimeoutIfExpired(io, current);
  }, Math.max(0, remaining) + 50); // 少し余裕を持たせる
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
      maybeScheduleTimeout(io, game);
    });

    socket.on(
      "move",
      async ({ gameId, playerToken, move }: { gameId: string; playerToken: string; move: Move }) => {
        try {
          if (!checkSocketRateLimit(`${socket.id}:move`, MOVE_RATE_LIMIT, MOVE_RATE_WINDOW_MS)) {
            socket.emit("error", { message: "rate_limited" });
            return;
          }

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

          if (await applyTimeoutIfExpired(io, game)) {
            socket.emit("error", { message: "time_up" });
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
          maybeScheduleTimeout(io, game);
        } catch (e) {
          // DB不整合等、想定外のエラーでプロセス全体が落ちないようにする(他の対局を巻き添えにしないため)。
          console.error(`[gameSocket move] failed for game ${gameId}:`, e);
          socket.emit("error", { message: "internal_error" });
        }
      }
    );

    socket.on("resign", async ({ gameId, playerToken }: { gameId: string; playerToken: string }) => {
      try {
        const game = getGame(gameId);
        if (!game) return;
        const color = colorForToken(game, playerToken);
        if (!color || game.state.result.status !== "in_progress") return;

        game.state.resign(color);
        await persistResultIfFinished(game);
        broadcastState(io, game);
      } catch (e) {
        console.error(`[gameSocket resign] failed for game ${gameId}:`, e);
      }
    });

    socket.on("disconnect", () => {
      clearSocketRateLimit(socket.id);
    });
  });
};
