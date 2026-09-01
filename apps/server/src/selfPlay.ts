import { RuleSet } from "@shogi-games/rule-engine";
import { AiProfile, AI_USER_IDS } from "./aiProfiles";
import { createAiVsAiGame, ServerGame } from "./gameManager";
import { ensureRuleSetPreset, prisma } from "./db";
import { persistMove, persistResultIfFinished } from "./gamePersistence";
import { chooseMoveForProfile } from "./ai/chooseMoveForProfile";

export interface SelfPlayGameSummary {
  gameId: string;
  dbGameId: string;
  moveCount: number;
  result: ServerGame["state"]["result"];
  durationMs: number;
}

/** AI Stage3: 自己対局データ収集基盤。AI同士の対局を、観戦者(socket接続)を必要とせずサーバー内で
 * 最後まで一気に進行させる。通常のAI同士対局(/ai-vs-ai)は観戦者が接続して初めて指し手が進む
 * (joinハンドラ経由でmaybeTriggerCpuMoveが動く)デザインだが、バッチ生成ではその都度接続する必要はないため、
 * ここでは直接ループで指し手を進める専用の経路を用意している。 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const playSelfPlayGame = async (params: {
  ruleSet: RuleSet;
  senteProfile: AiProfile;
  goteProfile: AiProfile;
  /** 一手ごとにこの時間だけ休む(ミリ秒)。バックグラウンドデーモンでCPU負荷を抑えるためのオプション。省略時は休まない。 */
  moveDelayMs?: number;
}): Promise<SelfPlayGameSummary> => {
  const senteUserId = AI_USER_IDS.get(params.senteProfile.slug);
  const goteUserId = AI_USER_IDS.get(params.goteProfile.slug);
  if (!senteUserId || !goteUserId) throw new Error("ai_profiles_not_ready");

  const game = createAiVsAiGame({
    ruleSet: params.ruleSet,
    senteProfile: params.senteProfile,
    senteUserId,
    goteProfile: params.goteProfile,
    goteUserId,
  });

  const ruleSetPresetId = await ensureRuleSetPreset(params.ruleSet);
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

  const start = Date.now();
  // 安全弁: ルール上は千日手判定などがあるので通常は決着するが、
  // 万一のバグで無限ループにならないよう上限手数を設けておく。
  const MAX_PLIES = 600;

  while (game.state.result.status === "in_progress" && game.state.history.length < MAX_PLIES) {
    const turn = game.state.turn;
    const profile = turn === "sente" ? params.senteProfile : params.goteProfile;
    const move = await chooseMoveForProfile(game.state.board, game.state.hands, turn, game.ruleSet, profile, {
      moveCountSoFar: game.state.history.length,
    });
    if (!move) break;

    const capturedKind = game.state.board.get(move.to)?.kind;
    game.state.applyMove(move);
    await persistMove(game, turn, move, capturedKind);
    if (params.moveDelayMs) await sleep(params.moveDelayMs);
  }

  await persistResultIfFinished(game);

  return {
    gameId: game.id,
    dbGameId: dbGame.id,
    moveCount: game.state.history.length,
    result: game.state.result,
    durationMs: Date.now() - start,
  };
};

/** count局まとめて自己対局させる。1局ずつ順番に実行する(並列化はStage3の発展課題)。 */
export const playSelfPlayBatch = async (params: {
  ruleSet: RuleSet;
  senteProfile: AiProfile;
  goteProfile: AiProfile;
  count: number;
}): Promise<SelfPlayGameSummary[]> => {
  const summaries: SelfPlayGameSummary[] = [];
  for (let i = 0; i < params.count; i++) {
    const summary = await playSelfPlayGame({
      ruleSet: params.ruleSet,
      senteProfile: params.senteProfile,
      goteProfile: params.goteProfile,
    });
    summaries.push(summary);
  }
  return summaries;
};
