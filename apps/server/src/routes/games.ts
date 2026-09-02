import { Router } from "express";
import {
  GameResult,
  Move,
  MoveRecord,
  Player,
  RULE_SET_METADATA,
  RuleSet,
  buildFreeSetupRuleSet,
  generateKifuText,
  getRuleSetById,
} from "@shogi-games/rule-engine";
import { createAiVsAiGame, createGame, getGame, joinPrivateGame } from "../gameManager";
import { ensureRuleSetPreset, prisma } from "../db";
import { getUserIdFromRequest } from "../auth";
import { AI_PROFILES, AI_USER_IDS, getAiProfileBySlug } from "../aiProfiles";
import { analyzeGameHistory } from "../analysis";
import { playSelfPlayBatch } from "../selfPlay";
import { gameCreationRateLimiter } from "../rateLimit";
import { asyncHandler } from "../asyncHandler";

export const gamesRouter = Router();

const resolveRuleSet = (body: Record<string, unknown>): { ruleSet: RuleSet; ruleSetId: string } => {
  if (body.customSetup && typeof body.customSetup === "object") {
    const custom = body.customSetup as { senteEntries: unknown; goteEntries: unknown };
    const ruleSet = buildFreeSetupRuleSet({
      id: `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      senteEntries: custom.senteEntries as never,
      goteEntries: custom.goteEntries as never,
    });
    return { ruleSet, ruleSetId: ruleSet.id };
  }

  const id = typeof body.ruleSetId === "string" ? body.ruleSetId : "standard";
  const validId = RULE_SET_METADATA.some((m) => m.id === id) ? id : "standard";
  return { ruleSet: getRuleSetById(validId), ruleSetId: validId };
};

const tokenFields = (color: Player, token: string) =>
  color === "sente" ? { senteToken: token } : { goteToken: token };

const userIdFields = (color: Player, userId: string | undefined) => {
  if (!userId) return {};
  return color === "sente" ? { senteUserId: userId } : { goteUserId: userId };
};

const MIN_TIME_CONTROL_MS = 60_000; // 1分
const MAX_TIME_CONTROL_MS = 3_600_000; // 60分

const resolveTimeControlMs = (value: unknown): number | undefined => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(MAX_TIME_CONTROL_MS, Math.max(MIN_TIME_CONTROL_MS, Math.floor(n)));
};

gamesRouter.get("/rule-sets", (_req, res) => {
  res.json({ ruleSets: RULE_SET_METADATA });
});

gamesRouter.get("/ai-profiles", (_req, res) => {
  res.json({ profiles: AI_PROFILES.map((p) => ({ slug: p.slug, name: p.name })) });
});

gamesRouter.post("/cpu", gameCreationRateLimiter, asyncHandler(async (req, res) => {
  const humanColor: Player = req.body?.color === "gote" ? "gote" : "sente";
  const userId = getUserIdFromRequest(req) ?? undefined;

  let resolved: { ruleSet: RuleSet; ruleSetId: string };
  try {
    resolved = resolveRuleSet(req.body ?? {});
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "invalid_rule_set" });
    return;
  }

  const aiProfile = getAiProfileBySlug(typeof req.body?.aiProfileSlug === "string" ? req.body.aiProfileSlug : "") ?? AI_PROFILES[1];
  const opponentAiUserId = AI_USER_IDS.get(aiProfile.slug);
  const timeControlMs = resolveTimeControlMs(req.body?.timeControlMs);

  const { game, playerToken } = createGame({
    mode: "cpu",
    ruleSet: resolved.ruleSet,
    humanColor,
    isOpponentCpu: true,
    humanUserId: userId,
    opponentAiProfile: aiProfile,
    opponentAiUserId,
    timeControlMs,
  });

  const opponentColor: Player = humanColor === "sente" ? "gote" : "sente";
  const ruleSetPresetId = await ensureRuleSetPreset(resolved.ruleSet);
  const dbGame = await prisma.game.create({
    data: {
      engineGameId: game.id,
      mode: "cpu",
      ruleSetPresetId,
      status: "in_progress",
      startedAt: new Date(),
      isSenteCpu: humanColor === "gote",
      isGoteCpu: humanColor === "sente",
      timeControlMs,
      ...tokenFields(humanColor, playerToken),
      ...userIdFields(humanColor, userId),
      ...userIdFields(opponentColor, opponentAiUserId),
    },
  });
  game.dbGameId = dbGame.id;

  res.json({
    gameId: game.id,
    playerToken,
    yourColor: humanColor,
    mode: "cpu",
    ruleSetId: resolved.ruleSetId,
    aiProfileSlug: aiProfile.slug,
  });
}));

gamesRouter.post("/private", gameCreationRateLimiter, asyncHandler(async (req, res) => {
  const humanColor: Player = req.body?.color === "gote" ? "gote" : "sente";
  const userId = getUserIdFromRequest(req) ?? undefined;

  let resolved: { ruleSet: RuleSet; ruleSetId: string };
  try {
    resolved = resolveRuleSet(req.body ?? {});
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "invalid_rule_set" });
    return;
  }

  const timeControlMs = resolveTimeControlMs(req.body?.timeControlMs);

  const { game, playerToken } = createGame({
    mode: "private",
    ruleSet: resolved.ruleSet,
    humanColor,
    isOpponentCpu: false,
    humanUserId: userId,
    timeControlMs,
  });

  const ruleSetPresetId = await ensureRuleSetPreset(resolved.ruleSet);
  const dbGame = await prisma.game.create({
    data: {
      engineGameId: game.id,
      mode: "private",
      ruleSetPresetId,
      status: "waiting",
      roomCode: game.roomCode,
      timeControlMs,
      ...tokenFields(humanColor, playerToken),
      ...userIdFields(humanColor, userId),
    },
  });
  game.dbGameId = dbGame.id;

  res.json({
    gameId: game.id,
    playerToken,
    yourColor: humanColor,
    roomCode: game.roomCode,
    mode: "private",
    ruleSetId: resolved.ruleSetId,
  });
}));

gamesRouter.post("/private/join", gameCreationRateLimiter, asyncHandler(async (req, res) => {
  const roomCode = String(req.body?.roomCode ?? "");
  const userId = getUserIdFromRequest(req) ?? undefined;
  const result = joinPrivateGame(roomCode, userId);
  if ("error" in result) {
    res.status(404).json({ error: result.error });
    return;
  }

  const { game, playerToken, color } = result;
  if (game.timeControl) {
    // 相手を待っている間は時計を進めたくないので、実際に対局が始まる(2人目が参加した)タイミングでリセットする。
    game.timeControl.turnStartedAt = Date.now();
  }
  if (game.dbGameId) {
    await prisma.game.update({
      where: { id: game.dbGameId },
      data: {
        status: "in_progress",
        startedAt: new Date(),
        ...tokenFields(color, playerToken),
        ...userIdFields(color, userId),
      },
    });
  }

  res.json({ gameId: game.id, playerToken, yourColor: color, mode: "private", ruleSetId: game.ruleSet.id });
}));

gamesRouter.post("/ai-vs-ai", gameCreationRateLimiter, asyncHandler(async (req, res) => {
  let resolved: { ruleSet: RuleSet; ruleSetId: string };
  try {
    resolved = resolveRuleSet(req.body ?? {});
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "invalid_rule_set" });
    return;
  }

  const senteProfile = getAiProfileBySlug(req.body?.senteAiProfileSlug) ?? AI_PROFILES[1];
  const goteProfile = getAiProfileBySlug(req.body?.goteAiProfileSlug) ?? AI_PROFILES[1];
  const senteUserId = AI_USER_IDS.get(senteProfile.slug);
  const goteUserId = AI_USER_IDS.get(goteProfile.slug);
  if (!senteUserId || !goteUserId) {
    res.status(500).json({ error: "ai_profiles_not_ready" });
    return;
  }

  const game = createAiVsAiGame({ ruleSet: resolved.ruleSet, senteProfile, senteUserId, goteProfile, goteUserId });

  const ruleSetPresetId = await ensureRuleSetPreset(resolved.ruleSet);
  const dbGame = await prisma.game.create({
    data: {
      engineGameId: game.id,
      mode: "cpu",
      ruleSetPresetId,
      status: "in_progress",
      startedAt: new Date(),
      isSenteCpu: true,
      isGoteCpu: true,
      senteUserId,
      goteUserId,
    },
  });
  game.dbGameId = dbGame.id;

  res.json({ gameId: game.id, ruleSetId: resolved.ruleSetId, senteProfile: senteProfile.slug, goteProfile: goteProfile.slug });
}));

/** サーバー再起動後は終局済みの対局がメモリ上から消えている(in-memoryのgames Mapは
 * 再起動時にin-progressの対局しか復元しない)ため、DBの生の指し手ログから棋譜情報を組み立て直す。
 * 自己対局データを後から振り返りたい場合、これが唯一の手段になる。 */
const reconstructKifuInputFromDb = async (
  engineGameId: string
): Promise<{ ruleSet: RuleSet; history: MoveRecord[]; result: GameResult; isSenteCpu: boolean; isGoteCpu: boolean } | null> => {
  const dbGame = await prisma.game.findUnique({
    where: { engineGameId },
    include: { ruleSetPreset: true, moves: { orderBy: { moveNumber: "asc" } } },
  });
  if (!dbGame) return null;

  const ruleSet = dbGame.ruleSetPreset.config as unknown as RuleSet;
  const history: MoveRecord[] = dbGame.moves.map((m) => {
    const move: Move =
      m.moveType === "move"
        ? { type: "move", from: { row: m.fromRow!, col: m.fromCol! }, to: { row: m.toRow, col: m.toCol }, piece: m.piece, promote: m.promote }
        : { type: "drop", to: { row: m.toRow, col: m.toCol }, piece: m.piece };
    return { player: m.player as Player, move, capturedKind: m.capturedPiece ?? undefined, checkedOpponent: false };
  });

  // DBのresultStatusはcheckmate/resigned/foul_loss以外を全て"draw"として保存しているため、
  // timeout/持将棋の細かい区別はここでは復元できない(近似としてdrawで表示する)。
  let result: GameResult;
  if (dbGame.status !== "finished") {
    result = { status: "in_progress" };
  } else if (dbGame.resultStatus === "checkmate" || dbGame.resultStatus === "resigned" || dbGame.resultStatus === "foul_loss") {
    result = { status: dbGame.resultStatus, winner: (dbGame.winner as Player) ?? "sente" } as GameResult;
  } else {
    result = { status: "draw", reason: "sennichite" };
  }

  return { ruleSet, history, result, isSenteCpu: dbGame.isSenteCpu, isGoteCpu: dbGame.isGoteCpu };
};

gamesRouter.get(
  "/:gameId/kifu",
  asyncHandler(async (req, res) => {
    const game = getGame(req.params.gameId);
    if (game) {
      const text = generateKifuText({
        ruleSet: game.ruleSet,
        history: game.state.history,
        result: game.state.result,
        sentePlayerName: game.cpuColors.sente ? "CPU" : "先手",
        gotePlayerName: game.cpuColors.gote ? "CPU" : "後手",
      });
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="kifu_${game.id}.kif"`);
      res.send(text);
      return;
    }

    const reconstructed = await reconstructKifuInputFromDb(req.params.gameId);
    if (!reconstructed) {
      res.status(404).json({ error: "game_not_found" });
      return;
    }
    const text = generateKifuText({
      ruleSet: reconstructed.ruleSet,
      history: reconstructed.history,
      result: reconstructed.result,
      sentePlayerName: reconstructed.isSenteCpu ? "CPU" : "先手",
      gotePlayerName: reconstructed.isGoteCpu ? "CPU" : "後手",
    });
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="kifu_${req.params.gameId}.kif"`);
    res.send(text);
  })
);

/** 過去の対局一覧(自己対局中心)。DBに保存済みのものであれば、サーバー再起動後でも一覧・閲覧できる。 */
gamesRouter.get(
  "/history",
  asyncHandler(async (req, res) => {
    const selfPlayOnly = req.query.selfPlayOnly !== "false";
    const games = await prisma.game.findMany({
      where: { status: "finished", ...(selfPlayOnly ? { isSenteCpu: true, isGoteCpu: true } : {}) },
      include: { ruleSetPreset: true, senteUser: true, goteUser: true, _count: { select: { moves: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({
      games: games.map((g) => ({
        gameId: g.engineGameId,
        ruleSetName: g.ruleSetPreset.name,
        senteName: g.senteUser?.name ?? "先手",
        goteName: g.goteUser?.name ?? "後手",
        resultStatus: g.resultStatus,
        winner: g.winner,
        moveCount: g._count.moves,
        createdAt: g.createdAt,
      })),
    });
  })
);

gamesRouter.get("/:gameId/analysis", asyncHandler(async (req, res) => {
  const game = getGame(req.params.gameId);
  if (!game) {
    res.status(404).json({ error: "game_not_found" });
    return;
  }

  const analysis = analyzeGameHistory(game.ruleSet, game.state.history);
  res.json({ gameId: game.id, analysis });
}));

const MAX_SELF_PLAY_BATCH = 20;

gamesRouter.post("/self-play-batch", gameCreationRateLimiter, async (req, res) => {
  let resolved: { ruleSet: RuleSet; ruleSetId: string };
  try {
    resolved = resolveRuleSet(req.body ?? {});
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "invalid_rule_set" });
    return;
  }

  const senteProfile = getAiProfileBySlug(req.body?.senteAiProfileSlug) ?? AI_PROFILES[1];
  const goteProfile = getAiProfileBySlug(req.body?.goteAiProfileSlug) ?? AI_PROFILES[1];
  const rawCount = Number(req.body?.count ?? 1);
  const count = Number.isFinite(rawCount) ? Math.min(MAX_SELF_PLAY_BATCH, Math.max(1, Math.floor(rawCount))) : 1;

  // 対局は思考時間の分だけ実時間がかかるため(例: ai_hard同士だと1手3秒程度)、まとめて多数生成すると
  // このHTTPリクエスト自体が長時間ブロックする。MAX_SELF_PLAY_BATCHで上限を設けているのはそのため。
  // 本格的なバッチ生成(数百局規模)にはバックグラウンドジョブキューへの移行が必要(AI Stage3の発展課題)。
  try {
    const summaries = await playSelfPlayBatch({ ruleSet: resolved.ruleSet, senteProfile, goteProfile, count });
    res.json({
      ruleSetId: resolved.ruleSetId,
      senteProfile: senteProfile.slug,
      goteProfile: goteProfile.slug,
      games: summaries,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "self_play_failed" });
  }
});
