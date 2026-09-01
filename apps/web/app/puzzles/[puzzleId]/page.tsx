"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Move, Player, Square } from "@shogi-games/rule-engine";
import { attemptPuzzleMove, fetchPuzzle, PuzzleDetail, PuzzleSnapshot } from "../../../lib/api";
import { pieceLabel } from "../../../lib/pieceLabels";
import { HandPanel } from "../../../components/Board";

type Cell = { kind: string; owner: Player; promoted: boolean } | null;

const cellsToGrid = (snapshot: PuzzleSnapshot, width: number, height: number): Cell[][] => {
  const grid: Cell[][] = Array.from({ length: height }, () => Array<Cell>(width).fill(null));
  for (const c of snapshot.board) {
    grid[c.row][c.col] = { kind: c.kind, owner: c.owner, promoted: c.promoted };
  }
  return grid;
};

// 成れない駒(金・王など)。攻め方が打つ手駒/移動の成り判定を簡易的に行うためのリスト。
const NON_PROMOTABLE = new Set(["gold", "king"]);

export default function PuzzleSolvePage() {
  const params = useParams<{ puzzleId: string }>();
  const router = useRouter();
  const puzzleId = params.puzzleId;

  const [puzzle, setPuzzle] = useState<PuzzleDetail | null>(null);
  const [snapshot, setSnapshot] = useState<PuzzleSnapshot | null>(null);
  const [movesSoFar, setMovesSoFar] = useState<Move[]>([]);
  const [turn, setTurn] = useState<Player>("sente");
  const [selectedFrom, setSelectedFrom] = useState<Square | null>(null);
  const [selectedHandPiece, setSelectedHandPiece] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("攻め方の手を指してください。");
  const [solved, setSolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState(0);

  useEffect(() => {
    fetchPuzzle(puzzleId)
      .then((p) => {
        setPuzzle(p);
        setSnapshot(p.snapshot);
        setTurn(p.snapshot.attacker);
      })
      .catch(() => setError("詰将棋を取得できませんでした。"));
  }, [puzzleId]);

  if (error) {
    return (
      <main className="p-8">
        <p>{error}</p>
      </main>
    );
  }
  if (!puzzle || !snapshot) {
    return (
      <main className="p-8">
        <p>読み込み中...</p>
      </main>
    );
  }

  const attacker = snapshot.attacker;
  const grid = cellsToGrid(snapshot, puzzle.boardWidth, puzzle.boardHeight);

  const clearSelection = () => {
    setSelectedFrom(null);
    setSelectedHandPiece(null);
  };

  const submitMove = async (move: Move) => {
    setAttemptCount((n) => n + 1);
    const result = await attemptPuzzleMove(puzzleId, movesSoFar, move);
    setMessage(result.message);
    setSnapshot(result.snapshot);
    if (!result.correct) {
      clearSelection();
      return;
    }
    if (result.solved) {
      setSolved(true);
      clearSelection();
      return;
    }
    const newMoves = [...movesSoFar, move, ...(result.defenderReply ? [result.defenderReply] : [])];
    setMovesSoFar(newMoves);
    setTurn(attacker); // 受け方の応手までサーバー側で適用済みなので、再び攻め方の手番に戻る
    clearSelection();
  };

  const handleSquareClick = (sq: Square) => {
    if (solved || turn !== attacker) return;
    const cell = grid[sq.row][sq.col];

    if (selectedFrom) {
      if (sq.row === selectedFrom.row && sq.col === selectedFrom.col) {
        clearSelection();
        return;
      }
      const piece = grid[selectedFrom.row][selectedFrom.col];
      if (!piece) {
        clearSelection();
        return;
      }
      if (cell && cell.owner === attacker) {
        setSelectedFrom(sq);
        return;
      }
      let promote = false;
      if (!NON_PROMOTABLE.has(piece.kind) && !piece.promoted) {
        const zoneRows = attacker === "sente" ? [0, 1, 2] : [puzzle.boardHeight - 1, puzzle.boardHeight - 2, puzzle.boardHeight - 3];
        const entersZone = zoneRows.includes(sq.row) || zoneRows.includes(selectedFrom.row);
        if (entersZone) promote = window.confirm("成りますか？");
      }
      submitMove({ type: "move", from: selectedFrom, to: sq, piece: piece.kind, promote });
      return;
    }

    if (selectedHandPiece) {
      if (cell) {
        clearSelection();
        return;
      }
      submitMove({ type: "drop", to: sq, piece: selectedHandPiece });
      return;
    }

    if (cell && cell.owner === attacker) {
      setSelectedFrom(sq);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center gap-4 p-8">
      <h1 className="text-xl font-bold">{puzzle.mateLength}手詰め</h1>
      <p className="text-sm text-neutral-600">
        攻め方: {attacker === "sente" ? "先手" : "後手"}(あなた)/ 手数: {attemptCount}
      </p>
      <p className={`text-sm ${solved ? "text-green-700 font-bold" : "text-neutral-700"}`}>{message}</p>

      <HandPanel
        owner={attacker === "sente" ? "gote" : "sente"}
        hand={snapshot.hands[attacker === "sente" ? "gote" : "sente"]}
        selectable={false}
        selectedHandPiece={null}
        onSelect={() => {}}
      />

      <div
        className="inline-grid border-2 border-neutral-800 bg-amber-100"
        style={{ gridTemplateColumns: `repeat(${puzzle.boardWidth}, 44px)` }}
      >
        {Array.from({ length: puzzle.boardHeight }, (_, r) => r).map((r) =>
          // 内部座標はcol0=1筋(右端)・col(width-1)=9筋(左端)なので、盤面図の慣習に合わせて列を反転して描画する。
          Array.from({ length: puzzle.boardWidth }, (_, i) => puzzle.boardWidth - 1 - i).map((c) => {
            const cell = grid[r][c];
            const isSelected = selectedFrom && selectedFrom.row === r && selectedFrom.col === c;
            return (
              <button
                key={`${r},${c}`}
                onClick={() => handleSquareClick({ row: r, col: c })}
                className={[
                  "h-11 w-11 border border-amber-800/40 flex items-center justify-center text-lg select-none",
                  isSelected ? "bg-amber-300" : "",
                  !solved && turn === attacker ? "hover:bg-amber-200" : "",
                ].join(" ")}
              >
                {cell && (
                  <span
                    className={["font-bold", cell.owner === "gote" ? "rotate-180" : "", cell.promoted ? "text-red-600" : "text-black"].join(
                      " "
                    )}
                  >
                    {pieceLabel(cell.kind)}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      <HandPanel
        owner={attacker}
        hand={snapshot.hands[attacker]}
        selectable={!solved && turn === attacker}
        selectedHandPiece={selectedHandPiece}
        onSelect={(kind) => {
          setSelectedFrom(null);
          setSelectedHandPiece((prev) => (prev === kind ? null : kind));
        }}
      />

      <div className="flex gap-4">
        <button className="text-sm underline text-neutral-500" onClick={() => router.push("/puzzles")}>
          一覧へ戻る
        </button>
        <button className="text-sm underline text-neutral-500" onClick={() => router.push("/")}>
          ロビーへ戻る
        </button>
      </div>
    </main>
  );
}
