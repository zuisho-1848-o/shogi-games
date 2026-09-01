import crypto from "node:crypto";
import { GameState, Move, Player, RuleSet, getRuleSetById as getRuleSetFromRegistry } from "@shogi-games/rule-engine";
import { AiProfile } from "./aiProfiles";

export type GameMode = "cpu" | "private" | "casual" | "randomMatch";

export interface ServerGame {
  id: string;
  mode: GameMode;
  ruleSet: RuleSet;
  state: GameState;
  tokens: Partial<Record<Player, string>>;
  cpuColors: Partial<Record<Player, boolean>>;
  /** サーバー内蔵CPUではなく、外部AI(ボット)が人間の代わりに接続してきたことの自己申告フラグ。相手側への表示にのみ使う。 */
  declaredBots?: Partial<Record<Player, boolean>>;
  /** cpuColorsがtrueの色について、どの強さのAIで指させるか。省略時はデフォルト設定を使う。 */
  aiConfig?: Partial<Record<Player, AiProfile>>;
  /** ログイン中のUserアカウントに紐づく対局かどうか(レーティング更新・対局履歴の紐付けに使う)。
   * ゲストプレイの場合は該当する色が入らない。CPU側はAIボットのUser.idが入る。 */
  userIds: Partial<Record<Player, string>>;
  roomCode?: string;
  dbGameId?: string;
  createdAt: number;
  /** 設定されていれば持ち時間制。片側あたりtotalMsミリ秒、消費すると時間切れ負け。 */
  timeControl?: TimeControlState;
}

export interface TimeControlState {
  totalMs: number;
  remainingMs: Record<Player, number>;
  /** 現在の手番がスタートした時刻(この時刻からの経過分がremainingMsから差し引かれる)。 */
  turnStartedAt: number;
}

const games = new Map<string, ServerGame>();
const roomCodeToGameId = new Map<string, string>();

const genId = () => crypto.randomBytes(12).toString("hex");
const genRoomCode = () => crypto.randomInt(100000, 999999).toString();
const genToken = () => crypto.randomBytes(16).toString("hex");

export const getRuleSetById = getRuleSetFromRegistry;

export const createGame = (params: {
  mode: GameMode;
  ruleSet: RuleSet;
  humanColor: Player;
  isOpponentCpu: boolean;
  humanUserId?: string;
  opponentAiProfile?: AiProfile;
  opponentAiUserId?: string;
  /** 指定すれば持ち時間制(片側あたりミリ秒)で対局を作成する。省略時は時間無制限。 */
  timeControlMs?: number;
}): { game: ServerGame; playerToken: string } => {
  const ruleSet = params.ruleSet;
  const id = genId();
  const opponentColor: Player = params.humanColor === "sente" ? "gote" : "sente";
  const playerToken = genToken();

  const game: ServerGame = {
    id,
    mode: params.mode,
    ruleSet,
    state: new GameState(ruleSet),
    tokens: { [params.humanColor]: playerToken },
    cpuColors: params.isOpponentCpu ? { [opponentColor]: true } : {},
    aiConfig: params.isOpponentCpu && params.opponentAiProfile ? { [opponentColor]: params.opponentAiProfile } : {},
    userIds: {
      ...(params.humanUserId ? { [params.humanColor]: params.humanUserId } : {}),
      ...(params.isOpponentCpu && params.opponentAiUserId ? { [opponentColor]: params.opponentAiUserId } : {}),
    },
    createdAt: Date.now(),
    timeControl: params.timeControlMs
      ? {
          totalMs: params.timeControlMs,
          remainingMs: { sente: params.timeControlMs, gote: params.timeControlMs },
          turnStartedAt: Date.now(),
        }
      : undefined,
  };

  if (params.mode === "private") {
    let code = genRoomCode();
    while (roomCodeToGameId.has(code)) code = genRoomCode();
    game.roomCode = code;
    roomCodeToGameId.set(code, id);
  }

  games.set(id, game);
  return { game, playerToken };
};

/** AI同士(観戦専用)の対局を作成する。人間のtokenは発行しない。 */
export const createAiVsAiGame = (params: {
  ruleSet: RuleSet;
  senteProfile: AiProfile;
  senteUserId: string;
  goteProfile: AiProfile;
  goteUserId: string;
}): ServerGame => {
  const id = genId();
  const game: ServerGame = {
    id,
    mode: "cpu",
    ruleSet: params.ruleSet,
    state: new GameState(params.ruleSet),
    tokens: {},
    cpuColors: { sente: true, gote: true },
    aiConfig: { sente: params.senteProfile, gote: params.goteProfile },
    userIds: { sente: params.senteUserId, gote: params.goteUserId },
    createdAt: Date.now(),
  };
  games.set(id, game);
  return game;
};

export const joinPrivateGame = (
  roomCode: string,
  userId?: string
): { game: ServerGame; playerToken: string; color: Player } | { error: string } => {
  const gameId = roomCodeToGameId.get(roomCode);
  if (!gameId) return { error: "room_not_found" };
  const game = games.get(gameId);
  if (!game) return { error: "room_not_found" };

  const takenColors = Object.keys(game.tokens) as Player[];
  if (takenColors.length >= 2) return { error: "room_full" };

  const color: Player = takenColors.includes("sente") ? "gote" : "sente";
  const playerToken = genToken();
  game.tokens[color] = playerToken;
  if (userId) game.userIds[color] = userId;

  return { game, playerToken, color };
};

export const getGame = (id: string): ServerGame | undefined => games.get(id);

/** 持ち時間制が有効な対局で、現在の手番側の消費時間を反映する。手番が変わるたびに(着手時・時間切れチェック時に)呼ぶ。
 * 消費の結果、残り時間が尽きていればそのプレイヤーの色を返す(呼び出し側で timeout() を呼んで決着させる)。
 * 時間切れでなければ、経過分を差し引いてturnStartedAtをリセットするだけでnullを返す。 */
export const consumeTurnTimeAndCheckTimeout = (game: ServerGame): Player | null => {
  const tc = game.timeControl;
  if (!tc || game.state.result.status !== "in_progress") return null;

  const turn = game.state.turn;
  const now = Date.now();
  const elapsed = now - tc.turnStartedAt;
  tc.remainingMs[turn] -= elapsed;
  tc.turnStartedAt = now;

  if (tc.remainingMs[turn] <= 0) {
    tc.remainingMs[turn] = 0;
    return turn;
  }
  return null;
};

/** サーバー再起動時、DBから復元したServerGameをin-memoryストアに登録する(restore.tsから呼ばれる)。 */
export const registerRestoredGame = (game: ServerGame): void => {
  games.set(game.id, game);
  if (game.roomCode) roomCodeToGameId.set(game.roomCode, game.id);
};

export const verifyToken = (game: ServerGame, color: Player, token: string): boolean =>
  game.tokens[color] === token;

export const colorForToken = (game: ServerGame, token: string): Player | null => {
  for (const color of ["sente", "gote"] as Player[]) {
    if (game.tokens[color] === token) return color;
  }
  return null;
};
