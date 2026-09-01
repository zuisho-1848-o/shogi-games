"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchPuzzles, PuzzleListItem } from "../../lib/api";

export default function PuzzlesListPage() {
  const [puzzles, setPuzzles] = useState<PuzzleListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPuzzles()
      .then(setPuzzles)
      .catch(() => setError("詰将棋の一覧を取得できませんでした。"));
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center gap-6 p-8">
      <h1 className="text-2xl font-bold">詰将棋</h1>
      <p className="text-sm text-neutral-500 max-w-md text-center">
        AI自己対局の実戦局面から自動抽出した詰将棋です。手数(攻め方の着手回数)ごとに並んでいます。
      </p>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      {!puzzles && !error && <p className="text-sm text-neutral-500">読み込み中...</p>}
      {puzzles?.length === 0 && <p className="text-sm text-neutral-500">まだ詰将棋がありません。</p>}

      <div className="flex flex-col gap-2 w-full max-w-md">
        {puzzles?.map((p) => (
          <Link
            key={p.id}
            href={`/puzzles/${p.id}`}
            className="border border-neutral-300 rounded px-4 py-3 hover:bg-neutral-50 flex justify-between items-center"
          >
            <span>{p.ruleSetName}</span>
            <span className="text-sm text-neutral-500">
              {p.mateLength}手詰め{p.occurrenceCount > 1 ? `(実戦${p.occurrenceCount}回出現)` : ""}
            </span>
          </Link>
        ))}
      </div>

      <Link href="/" className="text-sm underline text-neutral-500">
        ロビーへ戻る
      </Link>
    </main>
  );
}
