"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchLeaderboard, LeaderboardUser } from "../../lib/api";

export default function LeaderboardPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"human" | "ai">("human");
  const [users, setUsers] = useState<LeaderboardUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLeaderboard(tab)
      .then(setUsers)
      .catch((e) => setError(String(e)));
  }, [tab]);

  return (
    <main className="min-h-screen flex flex-col items-center gap-6 p-8">
      <h1 className="text-2xl font-bold">レーティング一覧</h1>
      <p className="text-sm text-neutral-500">人間とAIはレーティングプールが分かれています。</p>

      <div className="flex gap-2">
        <button
          onClick={() => setTab("human")}
          className={`px-4 py-2 rounded border ${tab === "human" ? "bg-neutral-900 text-white" : "border-neutral-300"}`}
        >
          人間
        </button>
        <button
          onClick={() => setTab("ai")}
          className={`px-4 py-2 rounded border ${tab === "ai" ? "bg-neutral-900 text-white" : "border-neutral-300"}`}
        >
          AI
        </button>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <table className="w-full max-w-md text-sm">
        <thead>
          <tr className="border-b text-left text-neutral-500">
            <th className="py-2">#</th>
            <th className="py-2">名前</th>
            <th className="py-2 text-right">レート</th>
            <th className="py-2 text-right">対局数</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u, i) => (
            <tr key={u.id} className="border-b border-neutral-100">
              <td className="py-2">{i + 1}</td>
              <td className="py-2">{u.name}</td>
              <td className="py-2 text-right font-mono">{u.rating}</td>
              <td className="py-2 text-right text-neutral-500">{u.gamesPlayed}</td>
            </tr>
          ))}
          {users.length === 0 && !error && (
            <tr>
              <td colSpan={4} className="py-4 text-center text-neutral-400">
                まだ対局がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <button className="text-sm underline text-neutral-500" onClick={() => router.push("/")}>
        ロビーへ戻る
      </button>
    </main>
  );
}
