"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { SERVER_URL, saveSession } from "./api";
import { getStoredToken } from "./auth";

export type MatchmakingStatus = "idle" | "waiting" | "error";
export type OpponentPreference = "human" | "ai" | "either";

export const useMatchmaking = () => {
  const [status, setStatus] = useState<MatchmakingStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const router = useRouter();

  const ensureSocket = (): Socket => {
    if (socketRef.current) return socketRef.current;

    const socket = io(SERVER_URL);
    socket.on("queue:waiting", () => setStatus("waiting"));
    socket.on("queue:left", () => setStatus("idle"));
    socket.on("queue:error", (e: { message: string }) => {
      setStatus("error");
      setError(e.message);
    });
    socket.on(
      "queue:matched",
      (data: { gameId: string; playerToken: string; yourColor: "sente" | "gote"; ruleSetId: string }) => {
        saveSession(data.gameId, { playerToken: data.playerToken, yourColor: data.yourColor });
        router.push(`/game/${data.gameId}`);
      }
    );

    socketRef.current = socket;
    return socket;
  };

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  const joinCasual = (
    ruleSetId: string,
    opponentPreference: OpponentPreference = "human",
    aiProfileSlug?: string
  ) => {
    setError(null);
    ensureSocket().emit("queue:join-casual", {
      ruleSetId,
      opponentPreference,
      aiProfileSlug,
      token: getStoredToken() ?? undefined,
    });
  };

  const joinRandom = (
    categories: string[],
    opponentPreference: OpponentPreference = "human",
    aiProfileSlug?: string
  ) => {
    setError(null);
    ensureSocket().emit("queue:join-random", {
      categories,
      opponentPreference,
      aiProfileSlug,
      token: getStoredToken() ?? undefined,
    });
  };

  const cancel = () => {
    socketRef.current?.emit("queue:leave");
    setStatus("idle");
  };

  return { status, error, joinCasual, joinRandom, cancel };
};
