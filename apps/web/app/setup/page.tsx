"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { STANDARD_PIECE_POOL, STANDARD_RULE_SET, Player } from "@shogi-games/rule-engine";
import {
  createCpuGameWithCustomSetup,
  createPrivateGameWithCustomSetup,
  saveSession,
} from "../../lib/api";
import { pieceLabel } from "../../lib/pieceLabels";

const BOARD_WIDTH = 9;
const BOARD_HEIGHT = 9;
const GOTE_EDITABLE_ROWS = [0, 1, 2, 3]; // 後手陣地(上4段)
const SENTE_EDITABLE_ROWS = [5, 6, 7, 8]; // 先手陣地(下4段)。row4は誰も置けない中立地帯。

interface PlacedPiece {
  kind: string;
  owner: Player;
}

type Placement = Record<string, PlacedPiece>; // "row,col" -> piece

const squareKey = (row: number, col: number) => `${row},${col}`;

const editableRowsFor = (owner: Player) => (owner === "sente" ? SENTE_EDITABLE_ROWS : GOTE_EDITABLE_ROWS);

const Palette = ({
  owner,
  armed,
  remaining,
  onPaletteClick,
  onReset,
  onClear,
}: {
  owner: Player;
  armed: string | null;
  remaining: (owner: Player, kind: string) => number;
  onPaletteClick: (owner: Player, kind: string) => void;
  onReset: (owner: Player) => void;
  onClear: (owner: Player) => void;
}) => (
  <div className="flex flex-col gap-1 items-center">
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">{owner === "sente" ? "先手" : "後手"}の駒</span>
      <button className="text-xs underline text-neutral-500" onClick={() => onReset(owner)}>
        標準配置にする
      </button>
      <button className="text-xs underline text-neutral-500" onClick={() => onClear(owner)}>
        クリア
      </button>
    </div>
    <div className="flex gap-1.5 flex-wrap justify-center max-w-2xl">
      {Object.keys(STANDARD_PIECE_POOL).map((kind) => (
        <button
          key={kind}
          onClick={() => onPaletteClick(owner, kind)}
          disabled={remaining(owner, kind) <= 0}
          className={[
            "px-2 py-1.5 border rounded text-sm",
            armed === kind ? "bg-amber-300 border-amber-600" : "bg-white border-neutral-300",
            remaining(owner, kind) <= 0 ? "opacity-40" : "hover:bg-amber-100",
          ].join(" ")}
        >
          {pieceLabel(kind)} 残り{remaining(owner, kind)}
        </button>
      ))}
    </div>
  </div>
);

export default function SetupPage() {
  const router = useRouter();
  const [placement, setPlacement] = useState<Placement>({});
  const [armedSente, setArmedSente] = useState<string | null>(null);
  const [armedGote, setArmedGote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usedCounts = useMemo(() => {
    const counts: Record<Player, Record<string, number>> = { sente: {}, gote: {} };
    for (const piece of Object.values(placement)) {
      counts[piece.owner][piece.kind] = (counts[piece.owner][piece.kind] ?? 0) + 1;
    }
    return counts;
  }, [placement]);

  const remaining = (owner: Player, kind: string) =>
    (STANDARD_PIECE_POOL[kind] ?? 0) - (usedCounts[owner][kind] ?? 0);

  const armed = { sente: armedSente, gote: armedGote };
  const setArmed = { sente: setArmedSente, gote: setArmedGote };

  const handlePaletteClick = (owner: Player, kind: string) => {
    if (remaining(owner, kind) <= 0) return;
    setArmed[owner]((prev) => (prev === kind ? null : kind));
  };

  const handleSquareClick = (row: number, col: number) => {
    const owner: Player | null = SENTE_EDITABLE_ROWS.includes(row)
      ? "sente"
      : GOTE_EDITABLE_ROWS.includes(row)
        ? "gote"
        : null;
    if (!owner) return;
    const key = squareKey(row, col);
    const armedKind = armed[owner];

    setPlacement((prev) => {
      const next = { ...prev };
      if (armedKind) {
        next[key] = { kind: armedKind, owner };
      } else if (next[key]?.owner === owner) {
        delete next[key];
      }
      return next;
    });
  };

  const resetToStandard = (owner: Player) => {
    setPlacement((prev) => {
      const rows = editableRowsFor(owner);
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        const [row] = key.split(",").map(Number);
        if (rows.includes(row)) delete next[key];
      }
      for (const p of STANDARD_RULE_SET.initialSetup[owner].pieces) {
        next[squareKey(p.square.row, p.square.col)] = { kind: p.kind, owner };
      }
      return next;
    });
  };

  const clearSide = (owner: Player) => {
    setPlacement((prev) => {
      const next = { ...prev };
      const rows = editableRowsFor(owner);
      for (const key of Object.keys(next)) {
        const [row] = key.split(",").map(Number);
        if (rows.includes(row)) delete next[key];
      }
      return next;
    });
  };

  const entriesFor = (owner: Player) =>
    Object.entries(placement)
      .filter(([, p]) => p.owner === owner)
      .map(([key, p]) => {
        const [row, col] = key.split(",").map(Number);
        return { kind: p.kind, square: { row, col } };
      });

  const senteEntries = entriesFor("sente");
  const goteEntries = entriesFor("gote");

  const hasSenteKing = (usedCounts.sente.king ?? 0) === 1;
  const hasGoteKing = (usedCounts.gote.king ?? 0) === 1;
  const canStart = hasSenteKing && hasGoteKing;

  const startGame = async (mode: "cpu" | "private") => {
    setBusy(true);
    setError(null);
    try {
      const customSetup = { senteEntries, goteEntries };
      const res =
        mode === "cpu"
          ? await createCpuGameWithCustomSetup(customSetup)
          : await createPrivateGameWithCustomSetup(customSetup);
      saveSession(res.gameId, {
        playerToken: res.playerToken,
        yourColor: res.yourColor,
        roomCode: res.roomCode,
      });
      router.push(`/game/${res.gameId}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center gap-4 p-8">
      <h1 className="text-2xl font-bold">自由配置将棋（先手・後手ともに自由に配置できます）</h1>
      <p className="text-sm text-neutral-500 max-w-lg text-center">
        上4段が後手陣地、下4段が先手陣地です(中央の1段は誰も置けない中立地帯)。駒パレットから駒を選び、自陣のマスをクリックして配置してください。もう一度クリックで解除できます。玉はそれぞれ必ず1枚配置してください。
      </p>

      <Palette
        owner="gote"
        armed={armedGote}
        remaining={remaining}
        onPaletteClick={handlePaletteClick}
        onReset={resetToStandard}
        onClear={clearSide}
      />

      <div
        className="inline-grid border-2 border-neutral-800 bg-amber-100"
        style={{ gridTemplateColumns: `repeat(${BOARD_WIDTH}, 44px)` }}
      >
        {Array.from({ length: BOARD_HEIGHT }, (_, row) =>
          // 内部座標はcol0=1筋(右端)・col(width-1)=9筋(左端)なので、盤面図の慣習に合わせて列を反転して描画する。
          Array.from({ length: BOARD_WIDTH }, (_, i) => BOARD_WIDTH - 1 - i).map((col) => {
            const owner: Player | null = SENTE_EDITABLE_ROWS.includes(row)
              ? "sente"
              : GOTE_EDITABLE_ROWS.includes(row)
                ? "gote"
                : null;
            const key = squareKey(row, col);
            const piece = placement[key];

            return (
              <button
                key={key}
                onClick={() => handleSquareClick(row, col)}
                disabled={!owner}
                className={[
                  "h-11 w-11 border border-amber-800/40 flex items-center justify-center text-lg select-none",
                  owner ? "hover:bg-amber-200" : "bg-neutral-200",
                ].join(" ")}
              >
                {piece && (
                  <span className={["font-bold", piece.owner === "gote" ? "rotate-180" : "", "text-blue-700"].join(" ")}>
                    {pieceLabel(piece.kind)}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      <Palette
        owner="sente"
        armed={armedSente}
        remaining={remaining}
        onPaletteClick={handlePaletteClick}
        onReset={resetToStandard}
        onClear={clearSide}
      />

      {!hasGoteKing && <p className="text-amber-700 text-sm">後手の玉を1枚配置してください</p>}
      {!hasSenteKing && <p className="text-amber-700 text-sm">先手の玉を1枚配置してください</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex gap-4">
        <button
          disabled={busy || !canStart}
          onClick={() => startGame("cpu")}
          className="px-4 py-3 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          この配置でCPU戦を始める
        </button>
        <button
          disabled={busy || !canStart}
          onClick={() => startGame("private")}
          className="px-4 py-3 rounded border border-neutral-900 hover:bg-neutral-100 disabled:opacity-50"
        >
          この配置でプライベートマッチを作成
        </button>
      </div>

      <button className="text-sm underline text-neutral-500" onClick={() => router.push("/")}>
        ロビーへ戻る
      </button>
    </main>
  );
}
