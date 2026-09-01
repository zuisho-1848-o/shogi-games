import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { Player, RULE_SET_METADATA, RuleSetCategory, getRuleSetById } from "@shogi-games/rule-engine";
import { createGame, ServerGame } from "./gameManager";
import { AI_USER_IDS, getAiProfileBySlug } from "./aiProfiles";
import { redis, withLock } from "./redisClient";

export type QueueMode = "casual" | "randomMatch";
/** human: 人間の相手だけを待つ。ai: 即座にAIと対局を始める(待機列には並ばない)。
 * either: 人間の相手を優先して探すが、条件緩和のタイミングで見つからなければAIにフォールバックする。 */
export type OpponentPreference = "human" | "ai" | "either";

/** ランダムルールマッチングで、この時間待っても相手が見つからなければ「どのルールでもOK」まで条件を緩和する。
 * human以外(eitherの場合)はこのタイミングでAIへのフォールバックも試みる。 */
const RELAX_TIMEOUT_MS = process.env.MATCH_RELAX_TIMEOUT_MS
  ? Number(process.env.MATCH_RELAX_TIMEOUT_MS)
  : 15000;
/** 待機列は複数のサーバープロセスで共有される(Redis)ため、タイマーの代わりに各プロセスが定期的に
 * 「緩和/AIフォールバックの時刻を過ぎたエントリがないか」をスイープする方式にしている。 */
const SWEEP_INTERVAL_MS = 1000;

const ALL_RULE_SET_IDS = RULE_SET_METADATA.map((m) => m.id);
const DEFAULT_AI_PROFILE_SLUG = "ai_medium";

const REDIS_KEY_ENTRIES = "matchqueue:entries"; // Hash: queueId -> JSON(QueueEntry)
const REDIS_KEY_SOCKET_INDEX = "matchqueue:socket_index"; // Hash: socketId -> queueId
const REDIS_KEY_LOCK = "matchqueue:lock";

interface QueueEntry {
  queueId: string;
  socketId: string;
  mode: QueueMode;
  ruleSetId?: string; // casual
  acceptedRuleSetIds?: string[]; // randomMatch
  enteredAt: number;
  relaxAt?: number; // この時刻を過ぎたらルール緩和(randomMatchのみ)
  relaxed?: boolean;
  aiFallbackAt?: number; // この時刻を過ぎたらAI対局にフォールバック(eitherのみ)
  /** 外部AI/ボットが接続してきた場合、自己申告のフラグ(サーバーは検証しない)。マッチ相手への表示に使う。 */
  isBot?: boolean;
  /** ログイン中のユーザーID(レーティング反映用)。ゲストはundefined。 */
  userId?: string;
  /** 'either'の場合のみ、条件緩和時にAIへフォールバックするために使う希望AI強度。 */
  aiProfileSlug?: string;
}

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

/** マッチが成立するたびに'matched'イベントで通知する(このプロセス内の待機ソケットへの通知用)。 */
export const matchEvents = new EventEmitter();

// ---- Redisアクセスのヘルパー ----

const readAllEntries = async (): Promise<QueueEntry[]> => {
  const raw = await redis.hgetall(REDIS_KEY_ENTRIES);
  return Object.values(raw).map((v) => JSON.parse(v) as QueueEntry);
};

const writeEntry = async (entry: QueueEntry): Promise<void> => {
  await redis.hset(REDIS_KEY_ENTRIES, entry.queueId, JSON.stringify(entry));
  await redis.hset(REDIS_KEY_SOCKET_INDEX, entry.socketId, entry.queueId);
};

const deleteEntry = async (entry: QueueEntry): Promise<void> => {
  await redis.hdel(REDIS_KEY_ENTRIES, entry.queueId);
  await redis.hdel(REDIS_KEY_SOCKET_INDEX, entry.socketId);
};

const findCompatible = (entries: QueueEntry[], entry: QueueEntry): QueueEntry | null => {
  if (entry.mode === "casual") {
    return (
      entries.find((q) => q.queueId !== entry.queueId && q.mode === "casual" && q.ruleSetId === entry.ruleSetId) ??
      null
    );
  }
  const acceptedSelf = new Set(entry.acceptedRuleSetIds ?? []);
  return (
    entries.find((q) => {
      if (q.queueId === entry.queueId || q.mode !== "randomMatch") return false;
      return (q.acceptedRuleSetIds ?? []).some((id) => acceptedSelf.has(id));
    }) ?? null
  );
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

/** キューに参加を試みる。即座にマッチする相手がいればゲームを作成して返す。いなければ待機列に入り、
 * ランダムルールマッチングの場合は一定時間後に条件を自動緩和する。opponentPreferenceが'ai'なら
 * 待機列を経由せず即座にAI対局を作る。'either'は人間優先→時間切れでAIにフォールバックする。
 * 待機列はRedis上で複数プロセス間で共有されるため、この関数はasync。 */
export const joinQueue = async (params: {
  socketId: string;
  mode: QueueMode;
  ruleSetId?: string;
  acceptedRuleSetIds?: string[];
  isBot?: boolean;
  userId?: string;
  opponentPreference?: OpponentPreference;
  aiProfileSlug?: string;
}): Promise<MatchResult | { waiting: true; queueId: string }> => {
  if (params.opponentPreference === "ai") {
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
    return buildAiMatchResult(entry);
  }

  return withLock(REDIS_KEY_LOCK, async () => {
    const now = Date.now();
    const entry: QueueEntry = {
      queueId: genId(),
      socketId: params.socketId,
      mode: params.mode,
      ruleSetId: params.ruleSetId,
      acceptedRuleSetIds: params.acceptedRuleSetIds,
      enteredAt: now,
      isBot: params.isBot,
      userId: params.userId,
      aiProfileSlug: params.aiProfileSlug,
      relaxAt: params.mode === "randomMatch" ? now + RELAX_TIMEOUT_MS : undefined,
      aiFallbackAt: params.opponentPreference === "either" ? now + RELAX_TIMEOUT_MS : undefined,
    };

    const entries = await readAllEntries();
    const opponent = findCompatible(entries, entry);
    if (!opponent) {
      await writeEntry(entry);
      return { waiting: true, queueId: entry.queueId };
    }

    await deleteEntry(opponent);
    return buildMatchResult(opponent, entry);
  });
};

export const leaveQueueBySocket = async (socketId: string): Promise<void> => {
  await withLock(REDIS_KEY_LOCK, async () => {
    const queueId = await redis.hget(REDIS_KEY_SOCKET_INDEX, socketId);
    if (!queueId) return;
    await redis.hdel(REDIS_KEY_ENTRIES, queueId);
    await redis.hdel(REDIS_KEY_SOCKET_INDEX, socketId);
  });
};

/** 定期的に待機列を確認し、緩和/AIフォールバックの時刻を過ぎたエントリを処理する。
 * 複数プロセスが同時に起動していても、ロックのおかげで二重処理は起きない。 */
const sweep = async (): Promise<void> => {
  await withLock(REDIS_KEY_LOCK, async () => {
    const now = Date.now();
    let entries = await readAllEntries();
    let changed = true;

    while (changed) {
      changed = false;

      for (const entry of entries) {
        if (entry.mode === "randomMatch" && !entry.relaxed && entry.relaxAt && entry.relaxAt <= now) {
          entry.relaxed = true;
          entry.acceptedRuleSetIds = ALL_RULE_SET_IDS;
          await writeEntry(entry);

          const opponent = findCompatible(entries, entry);
          if (opponent) {
            await deleteEntry(entry);
            await deleteEntry(opponent);
            entries = entries.filter((e) => e.queueId !== entry.queueId && e.queueId !== opponent.queueId);
            matchEvents.emit("matched", buildMatchResult(opponent, entry));
            changed = true;
            break;
          }
        }

        if (entry.aiFallbackAt && entry.aiFallbackAt <= now) {
          await deleteEntry(entry);
          entries = entries.filter((e) => e.queueId !== entry.queueId);
          matchEvents.emit("matched", buildAiMatchResult(entry));
          changed = true;
          break;
        }
      }
    }
  });
};

let sweepTimer: NodeJS.Timeout | undefined;

/** サーバー起動時に1回呼ぶ。プロセスごとに1つのスイープタイマーを回す。 */
export const startMatchQueueSweeper = (): void => {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    sweep().catch((e) => console.error("matchQueue sweep failed", e));
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
};
