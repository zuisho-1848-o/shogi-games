import { Router } from "express";
import {
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

gamesRouter.get("/rule-sets", (_req, res) => {
  res.json({ ruleSets: RULE_SET_METADATA });
});

gamesRouter.get("/ai-profiles", (_req, res) => {
  res.json({ profiles: AI_PROFILES.map((p) => ({ slug: p.slug, name: p.name })) });
});

gamesRouter.post("/cpu", async (req, res) => {
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

  const { game, playerToken } = createGame({
    mode: "cpu",
    ruleSet: resolved.ruleSet,
    humanColor,
    isOpponentCpu: true,
    humanUserId: userId,
    opponentAiProfile: aiProfile,
    opponentAiUserId,
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
});

gamesRouter.post("/private", async (req, res) => {
  const humanColor: Player = req.body?.color === "gote" ? "gote" : "sente";
  const userId = getUserIdFromRequest(req) ?? undefined;

  let resolved: { ruleSet: RuleSet; ruleSetId: string };
  try {
    resolved = resolveRuleSet(req.body ?? {});
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "invalid_rule_set" });
    return;
  }

  const { game, playerToken } = createGame({
    mode: "private",
    ruleSet: resolved.ruleSet,
    humanColor,
    isOpponentCpu: false,
    humanUserId: userId,
  });

  const ruleSetPresetId = await ensureRuleSetPreset(resolved.ruleSet);
  const dbGame = await prisma.game.create({
    data: {
      engineGameId: game.id,
      mode: "private",
      ruleSetPresetId,
      status: "waiting",
      roomCode: game.roomCode,
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
});

gamesRouter.post("/private/join", async (req, res) => {
  const roomCode = String(req.body?.roomCode ?? "");
  const userId = getUserIdFromRequest(req) ?? undefined;
  const result = joinPrivateGame(roomCode, userId);
  if ("error" in result) {
    res.status(404).json({ error: result.error });
    return;
  }

  const { game, playerToken, color } = result;
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
});

gamesRouter.post("/ai-vs-ai", async (req, res) => {
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
});

gamesRouter.get("/:gameId/kifu", (req, res) => {
  const game = getGame(req.params.gameId);
  if (!game) {
    res.status(404).json({ error: "game_not_found" });
    return;
  }

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
});

gamesRouter.get("/:gameId/analysis", async (req, res) => {
  const game = getGame(req.params.gameId);
  if (!game) {
    res.status(404).json({ error: "game_not_found" });
    return;
  }

  const analysis = analyzeGameHistory(game.ruleSet, game.state.history);
  res.json({ gameId: game.id, analysis });
});
