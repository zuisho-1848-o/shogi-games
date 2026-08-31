import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { Player, RULE_SET_METADATA, RuleSetCategory, getRuleSetById } from "@shogi-games/rule-engine";
import { createGame, ServerGame } from "./gameManager";
import { AI_USER_IDS, getAiProfileBySlug } from "./aiProfiles";

export type QueueMode = "casual" | "randomMatch";
/** human: 人間の相手だけを待つ。ai: 即座にAIと対局を始める(待機列には並ばない)。
 * either: 人間の相手を優先して探すが、条件緩和のタイミングで見つからなければAIにフォールバックする。 */
export type OpponentPreference = "human" | "ai" | "either";

/** ランダムルールマッチングで、この時間待っても相手が見つからなければ「どのルールでもOK」まで条件を緩和する。
 * human以外(eitherの場合)はこのタイミングでAIへのフォールバックも試みる。 */
const RELAX_TIMEOUT_MS = process.env.MATCH_RELAX_TIMEOUT_MS
  ? Number(process.env.MATCH_RELAX_TIMEOUT_MS)
  : 15000;

const ALL_RULE_SET_IDS = RULE_SET_METADATA.map((m) => m.id);
const DEFAULT_AI_PROFILE_SLUG = "ai_medium";

interface QueueEntry {
  queueId: string;
  socketId: string;
  mode: QueueMode;
  ruleSetId?: string; // casual
  acceptedRuleSetIds?: string[]; // randomMatch
  enteredAt: number;
  relaxTimer?: NodeJS.Timeout;
  relaxed?: boolean;
  /** 外部AI/ボットが接続してきた場合、自己申告のフラグ(サーバーは検証しない)。マッチ相手への表示に使う。 */
  isBot?: boolean;
  /** ログイン中のユーザーID(レーティング反映用)。ゲストはundefined。 */
  userId?: string;
  /** 'either'の場合のみ、条件緩和時にAIへフォールバックするために使う希望AI強度。 */
  aiProfileSlug?: string;
}

const queue: QueueEntry[] = [];
const queueIdBySocket = new Map<string, string>();

const genId = () => crypto.randomBytes(8).toString("hex");

export const categoriesToRuleSetIds = (categories: RuleSetCategory[]): string[] =>
  RULE_SET_METADATA.filter((m) => categories.includes(m.category)).map((m) => m.id);

export interface MatchResult {
  game: ServerGame;
  ruleSetId: string;
  assignments: { queueId: string; socketId: string; color: Player; playerToken: string; isBot: boolean }[];
  /** この色がAI(サーバー内蔵CPU)なら設定する。DB永続化(isSenteCpu/isGoteCpu, userId)のために使う。 */
  cpuColor?: Player;
}

/** マッチが成立するたびに'matched'イベントで通知する。即時マッチ・条件緩和後の遅延マッチのどちらもここに集約する。 */
export const matchEvents = new EventEmitter();

const findCompatibleIndex = (entry: QueueEntry, excludeQueueId?: string): number => {
  if (entry.mode === "casual") {
    return queue.findIndex((q) => q.queueId !== excludeQueueId && q.mode === "casual" && q.ruleSetId === entry.ruleSetId);
  }
  return queue.findIndex((q) => {
    if (q.queueId === excludeQueueId || q.mode !== "randomMatch") return false;
    const a = new Set(q.acceptedRuleSetIds ?? []);
    return (entry.acceptedRuleSetIds ?? []).some((id) => a.has(id));
  });
};

const buildMatchResult = (a: QueueEntry, b: QueueEntry): MatchResult => {
  let ruleSetId: string;
  if (a.mode === "casual") {
    ruleSetId = a.ruleSetId!;
  } else {
    const setB = new Set(b.acceptedRuleSetIds ?? []);
    const intersection = (a.acceptedRuleSetIds ?? []).filter((id) => setB.has(id));
    ruleSetId = intersection[Math.floor(Math.random() * intersection.length)];
  }

  const ruleSet = getRuleSetById(ruleSetId);
  // 先に並んでいた方(a)を先手にする。
  const { game, playerToken: senteToken } = createGame({
    mode: a.mode,
    ruleSet,
    humanColor: "sente",
    isOpponentCpu: false,
    humanUserId: a.userId,
  });
  const goteToken = crypto.randomBytes(16).toString("hex");
  game.tokens.gote = goteToken;
  if (b.userId) game.userIds.gote = b.userId;

  game.declaredBots = {
    ...(a.isBot ? { sente: true } : {}),
    ...(b.isBot ? { gote: true } : {}),
  };

  return {
    game,
    ruleSetId,
    assignments: [
      { queueId: a.queueId, socketId: a.socketId, color: "sente", playerToken: senteToken, isBot: !!a.isBot },
      { queueId: b.queueId, socketId: b.socketId, color: "gote", playerToken: goteToken, isBot: !!b.isBot },
    ],
  };
};

/** 待機列を経由せず、即座にAIとの対局を作る(希望preferenceが'ai'、または'either'のフォールバック時)。 */
const buildAiMatchResult = (entry: QueueEntry): MatchResult => {
  const ruleSetId =
    entry.mode === "casual"
      ? entry.ruleSetId!
      : (entry.acceptedRuleSetIds ?? ["standard"])[
          Math.floor(Math.random() * (entry.acceptedRuleSetIds ?? ["standard"]).length)
        ];
  const ruleSet = getRuleSetById(ruleSetId);
  const aiProfile = getAiProfileBySlug(entry.aiProfileSlug ?? "") ?? getAiProfileBySlug(DEFAULT_AI_PROFILE_SLUG)!;
  const opponentAiUserId = AI_USER_IDS.get(aiProfile.slug);

  const { game, playerToken } = createGame({
    mode: entry.mode,
    ruleSet,
    humanColor: "sente",
    isOpponentCpu: true,
    humanUserId: entry.userId,
    opponentAiProfile: aiProfile,
    opponentAiUserId,
  });

  return {
    game,
    ruleSetId,
    assignments: [{ queueId: entry.queueId, socketId: entry.socketId, color: "sente", playerToken, isBot: false }],
    cpuColor: "gote",
  };
};

const removeFromQueue = (queueId: string): QueueEntry | undefined => {
  const idx = queue.findIndex((q) => q.queueId === queueId);
  if (idx === -1) return undefined;
  const [entry] = queue.splice(idx, 1);
  if (entry.relaxTimer) clearTimeout(entry.relaxTimer);
  queueIdBySocket.delete(entry.socketId);
  return entry;
};

const scheduleRelax = (queueId: string) => {
  const timer = setTimeout(() => {
    const entry = queue.find((q) => q.queueId === queueId);
    if (!entry || entry.mode !== "randomMatch" || entry.relaxed) return;

    entry.relaxed = true;
    entry.acceptedRuleSetIds = ALL_RULE_SET_IDS;

    const matchIndex = findCompatibleIndex(entry, entry.queueId);
    if (matchIndex !== -1) {
      const opponent = queue[matchIndex];
      removeFromQueue(entry.queueId);
      removeFromQueue(opponent.queueId);
      matchEvents.emit("matched", buildMatchResult(opponent, entry));
      return;
    }

    // 相手が見つからなかった場合、either希望ならAIにフォールバックする。
    scheduleAiFallbackCheck(queueId);
  }, RELAX_TIMEOUT_MS);
  timer.unref?.();

  const entry = queue.find((q) => q.queueId === queueId);
  if (entry) entry.relaxTimer = timer;
};

/** either希望のエントリを、さらに一定時間待っても相手が見つからなければAI対局にフォールバックさせる。 */
const scheduleAiFallbackCheck = (queueId: string) => {
  const timer = setTimeout(() => {
    const entry = removeFromQueue(queueId);
    if (!entry) return;
    matchEvents.emit("matched", buildAiMatchResult(entry));
  }, RELAX_TIMEOUT_MS);
  timer.unref?.();

  const entry = queue.find((q) => q.queueId === queueId);
  if (entry) entry.relaxTimer = timer;
};

/** キューに参加を試みる。即座にマッチする相手がいればゲームを作成して返す。いなければ待機列に入り、
 * ランダムルールマッチングの場合は一定時間後に条件を自動緩和する。opponentPreferenceが'ai'なら
 * 待機列を経由せず即座にAI対局を作る。'either'は人間優先→時間切れでAIにフォールバックする。 */
export const joinQueue = (params: {
  socketId: string;
  mode: QueueMode;
  ruleSetId?: string;
  acceptedRuleSetIds?: string[];
  isBot?: boolean;
  userId?: string;
  opponentPreference?: OpponentPreference;
  aiProfileSlug?: string;
}): MatchResult | { waiting: true; queueId: string } => {
  const entry: QueueEntry = {
    queueId: genId(),
    socketId: params.socketId,
    mode: params.mode,
    ruleSetId: params.ruleSetId,
    acceptedRuleSetIds: params.acceptedRuleSetIds,
    enteredAt: Date.now(),
    isBot: params.isBot,
    userId: params.userId,
    aiProfileSlug: params.aiProfileSlug,
  };

  if (params.opponentPreference === "ai") {
    return buildAiMatchResult(entry);
  }

  const matchIndex = findCompatibleIndex(entry);
  if (matchIndex === -1) {
    queue.push(entry);
    queueIdBySocket.set(entry.socketId, entry.queueId);
    if (entry.mode === "randomMatch") {
      scheduleRelax(entry.queueId);
    } else if (params.opponentPreference === "either") {
      // カジュアルマッチはルール緩和という概念がないので、eitherならそのままAIフォールバックのタイマーだけ仕込む。
      scheduleAiFallbackCheck(entry.queueId);
    }
    return { waiting: true, queueId: entry.queueId };
  }

  const opponent = queue[matchIndex];
  removeFromQueue(opponent.queueId);
  return buildMatchResult(opponent, entry);
};

export const leaveQueueBySocket = (socketId: string): void => {
  const queueId = queueIdBySocket.get(socketId);
  if (!queueId) return;
  removeFromQueue(queueId);
};
