"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchGameAnalysis, PositionAnalysis } from "../../../../lib/api";
import { formatMove } from "../../../../lib/moveFormat";

const GRAPH_WIDTH = 640;
const GRAPH_HEIGHT = 200;
const EVAL_RANGE = 1000; // このスコアで上下いっぱいになるようにスケールする(それ以上はクリップ表示)

const EvalGraph = ({ analysis }: { analysis: PositionAnalysis[] }) => {
  if (analysis.length === 0) return null;

  const points = analysis.map((a, i) => {
    const x = (i / Math.max(1, analysis.length - 1)) * GRAPH_WIDTH;
    const clamped = Math.max(-EVAL_RANGE, Math.min(EVAL_RANGE, a.evalScoreForSente));
    const y = GRAPH_HEIGHT / 2 - (clamped / EVAL_RANGE) * (GRAPH_HEIGHT / 2 - 10);
    return { x, y, a };
  });

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <svg width={GRAPH_WIDTH} height={GRAPH_HEIGHT} className="border border-neutral-200 rounded bg-white">
      <line x1={0} y1={GRAPH_HEIGHT / 2} x2={GRAPH_WIDTH} y2={GRAPH_HEIGHT / 2} stroke="#d4d4d4" strokeWidth={1} />
      <text x={4} y={14} fontSize={10} fill="#a3a3a3">
        先手有利
      </text>
      <text x={4} y={GRAPH_HEIGHT - 4} fontSize={10} fill="#a3a3a3">
        後手有利
      </text>
      <path d={path} fill="none" stroke="#1d4ed8" strokeWidth={2} />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={p.a.isBestMove ? 2 : 3.5}
          fill={p.a.isBestMove ? "#1d4ed8" : "#dc2626"}
        />
      ))}
    </svg>
  );
};

export default function GameReviewPage() {
  const params = useParams<{ gameId: string }>();
  const router = useRouter();
  const gameId = params.gameId;

  const [analysis, setAnalysis] = useState<PositionAnalysis[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchGameAnalysis(gameId)
      .then(setAnalysis)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [gameId]);

  return (
    <main className="min-h-screen flex flex-col items-center gap-4 p-8">
      <h1 className="text-xl font-bold">対局振り返り: {gameId.slice(0, 8)}</h1>
      <p className="text-xs text-neutral-500 max-w-lg text-center">
        評価値は簡易AI(浅い探索)による目安です。折れ線は先手視点の評価値の推移、赤い点はAIの推奨手と実際の指し手が異なった箇所です。
      </p>

      {loading && <p className="text-neutral-500">解析中…(対局の手数に応じて数秒〜数十秒かかります)</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {analysis && (
        <>
          <EvalGraph analysis={analysis} />

          <div className="w-full max-w-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-neutral-500">
                  <th className="py-1 pr-2">手数</th>
                  <th className="py-1 pr-2">手番</th>
                  <th className="py-1 pr-2">実際の手</th>
                  <th className="py-1 pr-2">推奨手</th>
                  <th className="py-1 pr-2 text-right">評価値</th>
                </tr>
              </thead>
              <tbody>
                {analysis.map((a) => (
                  <tr
                    key={a.moveNumber}
                    className={`border-b border-neutral-100 ${!a.isBestMove ? "bg-red-50" : ""}`}
                  >
                    <td className="py-1 pr-2">{a.moveNumber}</td>
                    <td className="py-1 pr-2">{a.player === "sente" ? "先手" : "後手"}</td>
                    <td className="py-1 pr-2">{formatMove(a.actualMove)}</td>
                    <td className="py-1 pr-2 text-neutral-500">
                      {a.isBestMove ? "(同じ)" : formatMove(a.recommendedMove)}
                    </td>
                    <td className="py-1 pr-2 text-right font-mono">{a.evalScoreForSente}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="flex gap-4">
        <button className="text-sm underline text-neutral-500" onClick={() => router.push(`/game/${gameId}`)}>
          対局画面に戻る
        </button>
        <button className="text-sm underline text-neutral-500" onClick={() => router.push("/")}>
          ロビーへ戻る
        </button>
      </div>
    </main>
  );
}
