import { Move } from "@shogi-games/rule-engine";
import { getStoredToken } from "./auth";

export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

const authHeaders = (): Record<string, string> => {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export interface CreateGameResponse {
  gameId: string;
  playerToken: string;
  yourColor: "sente" | "gote";
  mode: string;
  roomCode?: string;
  aiProfileSlug?: string;
}

export interface PlacementEntryInput {
  kind: string;
  square: { row: number; col: number };
}

export interface CustomSetup {
  senteEntries: PlacementEntryInput[];
  goteEntries: PlacementEntryInput[];
}

export const createCpuGame = async (
  color: "sente" | "gote",
  ruleSetId: string,
  aiProfileSlug?: string,
  timeControlMs?: number
): Promise<CreateGameResponse> => {
  const res = await fetch(`${SERVER_URL}/api/games/cpu`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ color, ruleSetId, aiProfileSlug, timeControlMs }),
  });
  if (!res.ok) throw new Error("failed to create cpu game");
  return res.json();
};

export const createPrivateGame = async (
  color: "sente" | "gote",
  ruleSetId: string,
  timeControlMs?: number
): Promise<CreateGameResponse> => {
  const res = await fetch(`${SERVER_URL}/api/games/private`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ color, ruleSetId, timeControlMs }),
  });
  if (!res.ok) throw new Error("failed to create private game");
  return res.json();
};

export const joinPrivateGame = async (roomCode: string): Promise<CreateGameResponse> => {
  const res = await fetch(`${SERVER_URL}/api/games/private/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ roomCode }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "failed to join private game");
  }
  return res.json();
};

export const createCpuGameWithCustomSetup = async (
  customSetup: CustomSetup,
  aiProfileSlug?: string
): Promise<CreateGameResponse> => {
  const res = await fetch(`${SERVER_URL}/api/games/cpu`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ color: "sente", customSetup, aiProfileSlug }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "failed to create custom cpu game");
  }
  return res.json();
};

export const createPrivateGameWithCustomSetup = async (
  customSetup: CustomSetup
): Promise<CreateGameResponse> => {
  const res = await fetch(`${SERVER_URL}/api/games/private`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ color: "sente", customSetup }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "failed to create custom private game");
  }
  return res.json();
};

export interface AiProfileMeta {
  slug: string;
  name: string;
}

export const fetchAiProfiles = async (): Promise<AiProfileMeta[]> => {
  const res = await fetch(`${SERVER_URL}/api/games/ai-profiles`);
  if (!res.ok) throw new Error("failed to fetch ai profiles");
  const data = await res.json();
  return data.profiles;
};

export const createAiVsAiGame = async (params: {
  ruleSetId: string;
  senteAiProfileSlug: string;
  goteAiProfileSlug: string;
}): Promise<{ gameId: string }> => {
  const res = await fetch(`${SERVER_URL}/api/games/ai-vs-ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("failed to create ai-vs-ai game");
  return res.json();
};

export interface SelfPlayGameSummary {
  gameId: string;
  moveCount: number;
  result: { status: string; winner?: "sente" | "gote"; reason?: string };
  durationMs: number;
}

export const runSelfPlayBatch = async (params: {
  ruleSetId: string;
  senteAiProfileSlug: string;
  goteAiProfileSlug: string;
  count: number;
}): Promise<{ games: SelfPlayGameSummary[] }> => {
  const res = await fetch(`${SERVER_URL}/api/games/self-play-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("failed to run self-play batch");
  return res.json();
};

export interface LeaderboardUser {
  id: string;
  name: string;
  rating: number;
  gamesPlayed: number;
  isAi: boolean;
}

export const fetchLeaderboard = async (type: "human" | "ai"): Promise<LeaderboardUser[]> => {
  const res = await fetch(`${SERVER_URL}/api/users/leaderboard?type=${type}`);
  if (!res.ok) throw new Error("failed to fetch leaderboard");
  const data = await res.json();
  return data.users;
};

export interface PositionAnalysis {
  moveNumber: number;
  player: "sente" | "gote";
  actualMove: Move;
  recommendedMove: Move | null;
  evalScoreForSente: number;
  isBestMove: boolean;
}

export const fetchGameAnalysis = async (gameId: string): Promise<PositionAnalysis[]> => {
  const res = await fetch(`${SERVER_URL}/api/games/${gameId}/analysis`);
  if (!res.ok) throw new Error("failed to fetch analysis");
  const data = await res.json();
  return data.analysis;
};

export interface StoredSession {
  playerToken: string;
  yourColor: "sente" | "gote";
  roomCode?: string;
}

const sessionKey = (gameId: string) => `shogi-games:session:${gameId}`;

export const saveSession = (gameId: string, session: StoredSession) => {
  sessionStorage.setItem(sessionKey(gameId), JSON.stringify(session));
};

export const loadSession = (gameId: string): StoredSession | null => {
  const raw = sessionStorage.getItem(sessionKey(gameId));
  return raw ? JSON.parse(raw) : null;
};

export interface PuzzleListItem {
  id: string;
  ruleSetName: string;
  mateLength: number;
  occurrenceCount: number;
}

export const fetchPuzzles = async (): Promise<PuzzleListItem[]> => {
  const res = await fetch(`${SERVER_URL}/api/puzzles`);
  if (!res.ok) throw new Error("failed to fetch puzzles");
  const data = await res.json();
  return data.puzzles;
};

export interface PuzzleSnapshot {
  board: { row: number; col: number; kind: string; owner: "sente" | "gote"; promoted: boolean }[];
  hands: Record<"sente" | "gote", Record<string, number>>;
  attacker: "sente" | "gote";
}

export interface PuzzleDetail {
  id: string;
  ruleSetName: string;
  boardWidth: number;
  boardHeight: number;
  snapshot: PuzzleSnapshot;
  mateLength: number;
  occurrenceCount: number;
}

export const fetchPuzzle = async (id: string): Promise<PuzzleDetail> => {
  const res = await fetch(`${SERVER_URL}/api/puzzles/${id}`);
  if (!res.ok) throw new Error("failed to fetch puzzle");
  return res.json();
};

export interface PuzzleAttemptResponse {
  solved: boolean;
  correct: boolean;
  message: string;
  defenderReply?: Move;
  snapshot: PuzzleSnapshot;
}

export const attemptPuzzleMove = async (
  puzzleId: string,
  movesSoFar: Move[],
  move: Move
): Promise<PuzzleAttemptResponse> => {
  const res = await fetch(`${SERVER_URL}/api/puzzles/${puzzleId}/attempt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ movesSoFar, move }),
  });
  return res.json();
};

export interface GameHistoryItem {
  gameId: string;
  ruleSetName: string;
  senteName: string;
  goteName: string;
  resultStatus: string | null;
  winner: string | null;
  moveCount: number;
  createdAt: string;
}

export const fetchGameHistory = async (): Promise<GameHistoryItem[]> => {
  const res = await fetch(`${SERVER_URL}/api/games/history`);
  if (!res.ok) throw new Error("failed to fetch game history");
  const data = await res.json();
  return data.games;
};

export const kifuDownloadUrl = (gameId: string): string => `${SERVER_URL}/api/games/${gameId}/kifu`;
