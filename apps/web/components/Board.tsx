"use client";

import { Move, Player, Square } from "@shogi-games/rule-engine";
import { ClientGameState } from "../lib/useGameSocket";
import { PieceGlyph } from "./PieceGlyph";

interface BoardProps {
  state: ClientGameState;
  selectedFrom: Square | null;
  selectedHandPiece: string | null;
  onSquareClick: (sq: Square) => void;
}

const targetsFor = (
  legalMoves: Move[],
  selectedFrom: Square | null,
  selectedHandPiece: string | null
): Move[] => {
  if (selectedFrom) {
    return legalMoves.filter(
      (m) => m.type === "move" && m.from?.row === selectedFrom.row && m.from?.col === selectedFrom.col
    );
  }
  if (selectedHandPiece) {
    return legalMoves.filter((m) => m.type === "drop" && m.piece === selectedHandPiece);
  }
  return [];
};

export const Board = ({ state, selectedFrom, selectedHandPiece, onSquareClick }: BoardProps) => {
  const targets = targetsFor(state.legalMovesForYou, selectedFrom, selectedHandPiece);
  const targetSet = new Set(targets.map((m) => `${m.to.row},${m.to.col}`));

  const movableFromSquares = new Set(
    state.legalMovesForYou.filter((m) => m.type === "move").map((m) => `${m.from!.row},${m.from!.col}`)
  );

  // 後手視点では盤を180度回転させ、自陣が手前(下側)に来るようにする。観戦者は先手視点のまま。
  const flip = state.yourColor === "gote";
  const rowOrder = Array.from({ length: state.boardHeight }, (_, i) => (flip ? state.boardHeight - 1 - i : i));
  // 内部座標はcol0=1筋(右端)・col(width-1)=9筋(左端)。将棋の盤面図の慣習(先手視点で9筋が画面左)に合わせるため、
  // colOrderはrowOrderと逆向きにする(先手視点=flip:falseで列を右詰めに反転して描画する)。
  const colOrder = Array.from({ length: state.boardWidth }, (_, i) => (flip ? i : state.boardWidth - 1 - i));

  return (
    <div
      className="inline-grid border-2 border-neutral-800 bg-amber-100"
      style={{ gridTemplateColumns: `repeat(${state.boardWidth}, 44px)` }}
    >
      {rowOrder.map((r) =>
        colOrder.map((c) => {
          const cell = state.board[r][c];
          const key = `${r},${c}`;
          const isSelected = selectedFrom && selectedFrom.row === r && selectedFrom.col === c;
          const isTarget = targetSet.has(key);
          const isMovable =
            !selectedFrom && !selectedHandPiece && cell?.owner === state.yourColor && movableFromSquares.has(key);

          return (
            <button
              key={key}
              onClick={() => onSquareClick({ row: r, col: c })}
              className={[
                "h-11 w-11 border border-amber-800/40 flex items-center justify-center text-lg select-none",
                isSelected ? "bg-amber-300" : "",
                isTarget ? "bg-green-300" : "",
                isMovable && !isTarget ? "hover:bg-amber-200" : "",
              ].join(" ")}
            >
              {cell && (
                <PieceGlyph kind={cell.kind} promoted={cell.promoted} flipped={cell.owner !== (state.yourColor ?? "sente")} />
              )}
            </button>
          );
        })
      )}
    </div>
  );
};

// 持ち駒の並び順(将棋の一般的な並びに合わせる)。この一覧にない駒種(バリアントルール用等)は末尾に回す。
const HAND_KIND_ORDER = ["rook", "bishop", "gold", "silver", "knight", "lance", "pawn"];

export const HandPanel = ({
  owner,
  hand,
  selectable,
  selectedHandPiece,
  onSelect,
}: {
  owner: Player;
  hand: Record<string, number>;
  selectable: boolean;
  selectedHandPiece: string | null;
  onSelect: (kind: string) => void;
}) => {
  const entries = Object.entries(hand)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => {
      const ia = HAND_KIND_ORDER.indexOf(a);
      const ib = HAND_KIND_ORDER.indexOf(b);
      return (ia === -1 ? HAND_KIND_ORDER.length : ia) - (ib === -1 ? HAND_KIND_ORDER.length : ib);
    });
  return (
    <div className="flex gap-2 items-center min-h-8">
      <span className="text-xs text-neutral-500">{owner === "sente" ? "先手 持ち駒" : "後手 持ち駒"}</span>
      {entries.length === 0 && <span className="text-xs text-neutral-400">なし</span>}
      {entries.map(([kind, count]) => (
        <button
          key={kind}
          disabled={!selectable}
          onClick={() => onSelect(kind)}
          className={[
            "px-1.5 py-1 border rounded flex items-center gap-1",
            selectedHandPiece === kind ? "bg-amber-300 border-amber-600" : "bg-white border-neutral-300",
            !selectable ? "opacity-50 cursor-default" : "hover:bg-amber-100",
          ].join(" ")}
        >
          <PieceGlyph kind={kind} promoted={false} flipped={false} size={26} />
          <span className="text-sm">x{count}</span>
        </button>
      ))}
    </div>
  );
};
