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
  aiProfileSlug?: string
): Promise<CreateGameResponse> => {
  const res = await fetch(`${SERVER_URL}/api/games/cpu`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ color, ruleSetId, aiProfileSlug }),
  });
  if (!res.ok) throw new Error("failed to create cpu game");
  return res.json();
};

export const createPrivateGame = async (
  color: "sente" | "gote",
  ruleSetId: string
): Promise<CreateGameResponse> => {
  const res = await fetch(`${SERVER_URL}/api/games/private`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ color, ruleSetId }),
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
