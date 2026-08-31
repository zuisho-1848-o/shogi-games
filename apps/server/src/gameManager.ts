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
