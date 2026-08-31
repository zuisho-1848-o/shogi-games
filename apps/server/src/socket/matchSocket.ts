import { Server, Socket } from "socket.io";
import { RULE_SET_METADATA, RuleSetCategory } from "@shogi-games/rule-engine";
import {
  MatchResult,
  OpponentPreference,
  categoriesToRuleSetIds,
  joinQueue,
  leaveQueueBySocket,
  matchEvents,
} from "../matchQueue";
import { ensureRuleSetPreset, prisma } from "../db";
import { verifyToken } from "../auth";

const validRuleSetId = (id: unknown): id is string =>
  typeof id === "string" && RULE_SET_METADATA.some((m) => m.id === id);

const validCategories = (categories: unknown): categories is RuleSetCategory[] =>
  Array.isArray(categories) &&
  categories.length > 0 &&
  categories.every((c) => RULE_SET_METADATA.some((m) => m.category === c));

const validPreference = (p: unknown): p is OpponentPreference => p === "human" || p === "ai" || p === "either";

const userIdFromToken = (token: unknown): string | undefined => {
  if (typeof token !== "string") return undefined;
  return verifyToken(token)?.userId ?? undefined;
};

export const registerMatchSocket = (io: Server) => {
  // 条件緩和後の遅延マッチはjoinQueue()の戻り値ではなくイベント経由で通知される。
  // registerMatchSocketはサーバー起動時に1回しか呼ばれないので、リスナーも1つだけ登録される。
  matchEvents.on("matched", (result: MatchResult) => {
    finalizeMatch(io, result).catch((e) => console.error("finalizeMatch failed", e));
  });

  io.on("connection", (socket: Socket) => {
    socket.on(
      "queue:join-casual",
      async (payload: {
        ruleSetId: unknown;
        isBot?: unknown;
        opponentPreference?: unknown;
        aiProfileSlug?: unknown;
        token?: unknown;
      }) => {
        if (!validRuleSetId(payload.ruleSetId)) {
          socket.emit("queue:error", { message: "invalid_rule_set" });
          return;
        }

        const result = joinQueue({
          socketId: socket.id,
          mode: "casual",
          ruleSetId: payload.ruleSetId,
          isBot: payload.isBot === true,
          userId: userIdFromToken(payload.token),
          opponentPreference: validPreference(payload.opponentPreference) ? payload.opponentPreference : "human",
          aiProfileSlug: typeof payload.aiProfileSlug === "string" ? payload.aiProfileSlug : undefined,
        });
        if ("waiting" in result) {
          socket.emit("queue:waiting", { mode: "casual" });
          return;
        }
        await finalizeMatch(io, result);
      }
    );

    socket.on(
      "queue:join-random",
      async (payload: {
        categories: unknown;
        isBot?: unknown;
        opponentPreference?: unknown;
        aiProfileSlug?: unknown;
        token?: unknown;
      }) => {
        if (!validCategories(payload.categories)) {
          socket.emit("queue:error", { message: "invalid_categories" });
          return;
        }

        const acceptedRuleSetIds = categoriesToRuleSetIds(payload.categories);
        if (acceptedRuleSetIds.length === 0) {
          socket.emit("queue:error", { message: "no_matching_rule_sets" });
          return;
        }

        const result = joinQueue({
          socketId: socket.id,
          mode: "randomMatch",
          acceptedRuleSetIds,
          isBot: payload.isBot === true,
          userId: userIdFromToken(payload.token),
          opponentPreference: validPreference(payload.opponentPreference) ? payload.opponentPreference : "human",
          aiProfileSlug: typeof payload.aiProfileSlug === "string" ? payload.aiProfileSlug : undefined,
        });
        if ("waiting" in result) {
          socket.emit("queue:waiting", { mode: "randomMatch" });
          return;
        }
        await finalizeMatch(io, result);
      }
    );

    socket.on("queue:leave", () => {
      leaveQueueBySocket(socket.id);
      socket.emit("queue:left");
    });

    socket.on("disconnect", () => {
      leaveQueueBySocket(socket.id);
    });
  });
};

const finalizeMatch = async (io: Server, result: MatchResult) => {
  const { game, ruleSetId, assignments, cpuColor } = result;

  const ruleSetPresetId = await ensureRuleSetPreset(game.ruleSet);
  const sente = assignments.find((a) => a.color === "sente");
  const gote = assignments.find((a) => a.color === "gote");
  const dbGame = await prisma.game.create({
    data: {
      engineGameId: game.id,
      mode: game.mode,
      ruleSetPresetId,
      status: "in_progress",
      startedAt: new Date(),
      senteToken: sente?.playerToken,
      goteToken: gote?.playerToken,
      isSenteCpu: cpuColor === "sente",
      isGoteCpu: cpuColor === "gote",
      senteUserId: game.userIds.sente,
      goteUserId: game.userIds.gote,
    },
  });
  game.dbGameId = dbGame.id;

  for (const a of assignments) {
    io.to(a.socketId).emit("queue:matched", {
      gameId: game.id,
      playerToken: a.playerToken,
      yourColor: a.color,
      ruleSetId,
    });
  }
};
