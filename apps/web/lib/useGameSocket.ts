"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { Move, Player } from "@shogi-games/rule-engine";
import { SERVER_URL } from "./api";

export interface ClientPiece {
  kind: string;
  owner: Player;
  promoted: boolean;
}

export interface ClientGameState {
  gameId: string;
  boardWidth: number;
  boardHeight: number;
  board: (ClientPiece | null)[][];
  hands: Record<Player, Record<string, number>>;
  turn: Player;
  result:
    | { status: "in_progress" }
    | { status: "checkmate"; winner: Player }
    | { status: "resigned"; winner: Player }
    | { status: "draw"; reason: string }
    | { status: "foul_loss"; winner: Player; reason: string };
  legalMovesForYou: Move[];
  yourColor: Player | null;
  isInCheck: Record<Player, boolean>;
  roomCode?: string;
  bothPlayersConnected: boolean;
  opponentIsCpuOrBot: Partial<Record<Player, boolean>>;
}

export const useGameSocket = (gameId: string, playerToken: string | undefined) => {
  const [state, setState] = useState<ClientGameState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join", { gameId, playerToken });
    });
    socket.on("state", (s: ClientGameState) => setState(s));
    socket.on("error", (e: { message: string }) => setErrorMessage(e.message));

    return () => {
      socket.disconnect();
    };
  }, [gameId, playerToken]);

  const sendMove = (move: Move) => {
    if (!playerToken) return;
    socketRef.current?.emit("move", { gameId, playerToken, move });
  };

  const resign = () => {
    if (!playerToken) return;
    socketRef.current?.emit("resign", { gameId, playerToken });
  };

  return { state, errorMessage, sendMove, resign };
};
