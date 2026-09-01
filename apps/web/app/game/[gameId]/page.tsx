"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Player, Square } from "@shogi-games/rule-engine";
import { useGameSocket } from "../../../lib/useGameSocket";
import { loadSession, SERVER_URL, StoredSession } from "../../../lib/api";
import { Board, HandPanel } from "../../../components/Board";

const resultLabel = (result: ReturnType<typeof useGameSocket>["state"]): string => {
  if (!result) return "";
  if (result.result.status === "in_progress") return "対局中";
  if (result.result.status === "checkmate") return `詰み。${result.result.winner === "sente" ? "先手" : "後手"}の勝ち`;
  if (result.result.status === "resigned") return `投了。${result.result.winner === "sente" ? "先手" : "後手"}の勝ち`;
  if (result.result.status === "foul_loss")
    return `反則負け(連続王手の千日手)。${result.result.winner === "sente" ? "先手" : "後手"}の勝ち`;
  if (result.result.status === "jishogi_win")
    return `持将棋(入玉勝ち)。${result.result.winner === "sente" ? "先手" : "後手"}の勝ち`;
  if (result.result.status === "timeout")
    return `時間切れ。${result.result.winner === "sente" ? "先手" : "後手"}の勝ち`;
  return "引き分け";
};

const formatClock = (ms: number): string => {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const ClockPanel = ({
  color,
  totalMs,
  remainingMs,
  isActive,
  receivedAt,
  tick,
}: {
  color: Player;
  totalMs: number;
  remainingMs: number;
  isActive: boolean;
  receivedAt: number;
  tick: number;
}) => {
  // サーバーからのスナップショット(remainingMs, receivedAt時点)を、手番側のみクライアント側で1秒ごとに減算して表示する。
  const displayed = isActive ? remainingMs - (Date.now() - receivedAt) : remainingMs;
  const isLow = displayed < 30_000;
  void tick; // 再レンダリングのトリガーとしてのみ使う

  return (
    <div
      className={[
        "px-3 py-1 rounded font-mono text-sm",
        isActive ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-500",
        isLow && isActive ? "bg-red-700" : "",
      ].join(" ")}
    >
      {color === "sente" ? "先手" : "後手"} {formatClock(displayed)} / {formatClock(totalMs)}
    </div>
  );
};

export default function GamePage() {
  const params = useParams<{ gameId: string }>();
  const router = useRouter();
  const gameId = params.gameId;

  const [session, setSession] = useState<StoredSession | null>(null);
  useEffect(() => {
    setSession(loadSession(gameId));
  }, [gameId]);

  const { state, errorMessage, sendMove, resign } = useGameSocket(gameId, session?.playerToken);

  const [selectedFrom, setSelectedFrom] = useState<Square | null>(null);
  const [selectedHandPiece, setSelectedHandPiece] = useState<string | null>(null);
  const [receivedAt, setReceivedAt] = useState(Date.now());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setReceivedAt(Date.now());
  }, [state?.timeControl?.remainingMs.sente, state?.timeControl?.remainingMs.gote]);

  useEffect(() => {
    if (!state?.timeControl || state.result.status !== "in_progress") return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [state?.timeControl, state?.result.status]);

  const isMyTurn = !!state && state.yourColor === state.turn && state.result.status === "in_progress";

  const clearSelection = () => {
    setSelectedFrom(null);
    setSelectedHandPiece(null);
  };

  const handleSquareClick = (sq: Square) => {
    if (!state || !isMyTurn) return;
    const cell = state.board[sq.row][sq.col];

    if (selectedHandPiece) {
      const candidates = state.legalMovesForYou.filter(
        (m) => m.type === "drop" && m.piece === selectedHandPiece && m.to.row === sq.row && m.to.col === sq.col
      );
      if (candidates.length > 0) {
        sendMove(candidates[0]);
        clearSelection();
        return;
      }
      if (cell && cell.owner === state.yourColor) {
        setSelectedHandPiece(null);
        setSelectedFrom(sq);
        return;
      }
      clearSelection();
      return;
    }

    if (selectedFrom) {
      if (selectedFrom.row === sq.row && selectedFrom.col === sq.col) {
        clearSelection();
        return;
      }
      const candidates = state.legalMovesForYou.filter(
        (m) =>
          m.type === "move" &&
          m.from?.row === selectedFrom.row &&
          m.from?.col === selectedFrom.col &&
          m.to.row === sq.row &&
          m.to.col === sq.col
      );
      if (candidates.length > 0) {
        let chosen = candidates[0];
        if (candidates.length > 1) {
          const promote = window.confirm("成りますか？");
          chosen = candidates.find((c) => !!c.promote === promote) ?? candidates[0];
        }
        sendMove(chosen);
        clearSelection();
        return;
      }
      if (cell && cell.owner === state.yourColor) {
        setSelectedFrom(sq);
        return;
      }
      clearSelection();
      return;
    }

    if (cell && cell.owner === state.yourColor) {
      setSelectedFrom(sq);
    }
  };

  const handleHandSelect = (kind: string) => {
    if (!isMyTurn) return;
    setSelectedFrom(null);
    setSelectedHandPiece((prev) => (prev === kind ? null : kind));
  };

  if (!state) {
    return (
      <main className="p-8">
        <p>接続中...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center gap-4 p-8">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold">対局: {gameId.slice(0, 8)}</h1>
        <span className="text-sm text-neutral-500">
          あなたは{state.yourColor === "sente" ? "先手" : state.yourColor === "gote" ? "後手" : "観戦"}
        </span>
      </div>

      {state.roomCode && !state.bothPlayersConnected && (
        <p className="text-amber-700 bg-amber-100 px-4 py-2 rounded">
          相手待ち中… ルームコード: <span className="font-mono font-bold">{state.roomCode}</span>
        </p>
      )}

      {state.yourColor && state.opponentIsCpuOrBot[state.yourColor === "sente" ? "gote" : "sente"] && (
        <span className="text-xs bg-neutral-800 text-white px-2 py-1 rounded-full">🤖 対戦相手はCPU/ボットです</span>
      )}

      {state.timeControl && (
        <div className="flex gap-3">
          <ClockPanel
            color="gote"
            totalMs={state.timeControl.totalMs}
            remainingMs={state.timeControl.remainingMs.gote}
            isActive={state.turn === "gote" && state.result.status === "in_progress"}
            receivedAt={receivedAt}
            tick={tick}
          />
          <ClockPanel
            color="sente"
            totalMs={state.timeControl.totalMs}
            remainingMs={state.timeControl.remainingMs.sente}
            isActive={state.turn === "sente" && state.result.status === "in_progress"}
            receivedAt={receivedAt}
            tick={tick}
          />
        </div>
      )}

      <p className="font-medium">{resultLabel(state)}</p>
      {state.result.status === "in_progress" && (
        <p className="text-sm">
          手番: {state.turn === "sente" ? "先手" : "後手"}
          {state.isInCheck[state.turn] && <span className="text-red-600 font-bold"> ／ 王手!</span>}
        </p>
      )}
      {errorMessage && <p className="text-red-600 text-sm">エラー: {errorMessage}</p>}

      <HandPanel
        owner="gote"
        hand={state.hands.gote}
        selectable={isMyTurn && state.yourColor === "gote"}
        selectedHandPiece={state.yourColor === "gote" ? selectedHandPiece : null}
        onSelect={handleHandSelect}
      />

      <Board state={state} selectedFrom={selectedFrom} selectedHandPiece={selectedHandPiece} onSquareClick={handleSquareClick} />

      <HandPanel
        owner="sente"
        hand={state.hands.sente}
        selectable={isMyTurn && state.yourColor === "sente"}
        selectedHandPiece={state.yourColor === "sente" ? selectedHandPiece : null}
        onSelect={handleHandSelect}
      />

      {state.result.status === "in_progress" && state.yourColor && (
        <button
          onClick={() => {
            if (window.confirm("投了しますか？")) resign();
          }}
          className="text-sm text-red-600 underline"
        >
          投了する
        </button>
      )}

      <a
        className="text-sm underline text-neutral-500"
        href={`${SERVER_URL}/api/games/${gameId}/kifu`}
        target="_blank"
        rel="noopener noreferrer"
      >
        棋譜をダウンロード(KIF)
      </a>

      <button className="text-sm underline text-neutral-500" onClick={() => router.push(`/game/${gameId}/review`)}>
        対局を振り返る（評価値グラフ・推奨手）
      </button>

      <button className="text-sm underline text-neutral-500" onClick={() => router.push("/")}>
        ロビーへ戻る
      </button>
    </main>
  );
}
