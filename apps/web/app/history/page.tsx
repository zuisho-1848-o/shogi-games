"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchGameHistory, GameHistoryItem, kifuDownloadUrl } from "../../lib/api";

const resultLabel = (item: GameHistoryItem): string => {
  const winnerLabel = item.winner === "sente" ? "先手" : item.winner === "gote" ? "後手" : null;
  switch (item.resultStatus) {
    case "checkmate":
      return `詰み(${winnerLabel}の勝ち)`;
    case "resigned":
      return `投了(${winnerLabel}の勝ち)`;
    case "foul_loss":
      return `反則負け(${winnerLabel}の勝ち)`;
    case "draw":
      return "引き分け";
    default:
      return item.resultStatus ?? "不明";
  }
};

export default function GameHistoryPage() {
  const [games, setGames] = useState<GameHistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGameHistory()
      .then(setGames)
      .catch(() => setError("対局履歴を取得できませんでした。"));
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center gap-6 p-8">
      <h1 className="text-2xl font-bold">対局履歴(自己対局)</h1>
      <p className="text-sm text-neutral-500 max-w-md text-center">
        サーバー再起動後は対局画面から棋譜を見られなくなりますが、DBには残っているのでここから棋譜(KIF)をダウンロードできます。
      </p>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      {!games && !error && <p className="text-sm text-neutral-500">読み込み中...</p>}
      {games?.length === 0 && <p className="text-sm text-neutral-500">まだ対局履歴がありません。</p>}

      <div className="flex flex-col gap-2 w-full max-w-2xl">
        {games?.map((g) => (
          <div key={g.gameId} className="border border-neutral-300 rounded px-4 py-3 flex justify-between items-center gap-4">
            <div>
              <div className="text-sm font-medium">
                {g.ruleSetName} / {g.senteName} vs {g.goteName}
              </div>
              <div className="text-xs text-neutral-500">
                {resultLabel(g)} / {g.moveCount}手 / {new Date(g.createdAt).toLocaleString("ja-JP")}
              </div>
            </div>
            <a
              className="text-sm underline text-neutral-600 shrink-0"
              href={kifuDownloadUrl(g.gameId)}
              target="_blank"
              rel="noreferrer"
            >
              棋譜(KIF)
            </a>
          </div>
        ))}
      </div>

      <Link href="/" className="text-sm underline text-neutral-500">
        ロビーへ戻る
      </Link>
    </main>
  );
}
