"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AiProfileMeta,
  createAiVsAiGame,
  fetchAiProfiles,
  runSelfPlayBatch,
  SelfPlayGameSummary,
} from "../../lib/api";
import { fetchRuleSets, RuleSetMeta } from "../../lib/ruleSets";

export default function AiArenaPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<AiProfileMeta[]>([]);
  const [ruleSets, setRuleSets] = useState<RuleSetMeta[]>([]);
  const [senteSlug, setSenteSlug] = useState("ai_easy");
  const [goteSlug, setGoteSlug] = useState("ai_hard");
  const [ruleSetId, setRuleSetId] = useState("standard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [batchCount, setBatchCount] = useState(3);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResults, setBatchResults] = useState<SelfPlayGameSummary[] | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  useEffect(() => {
    fetchAiProfiles().then(setProfiles).catch(() => {});
    fetchRuleSets().then(setRuleSets).catch(() => {});
  }, []);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await createAiVsAiGame({ ruleSetId, senteAiProfileSlug: senteSlug, goteAiProfileSlug: goteSlug });
      router.push(`/game/${res.gameId}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const runBatch = async () => {
    setBatchBusy(true);
    setBatchError(null);
    setBatchResults(null);
    try {
      const res = await runSelfPlayBatch({
        ruleSetId,
        senteAiProfileSlug: senteSlug,
        goteAiProfileSlug: goteSlug,
        count: batchCount,
      });
      setBatchResults(res.games);
    } catch (e) {
      setBatchError(String(e));
    } finally {
      setBatchBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center gap-6 p-8">
      <h1 className="text-2xl font-bold">AI同士の対局を観戦</h1>
      <p className="text-sm text-neutral-500 max-w-md text-center">
        2つのAIプロファイルを選んで対局させ、観戦できます。両者の対局結果はそれぞれのAIのレーティングにも反映されます。
      </p>

      <div className="flex flex-col gap-3 w-full max-w-sm">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-neutral-600">ルールセット</span>
          <select
            value={ruleSetId}
            onChange={(e) => setRuleSetId(e.target.value)}
            className="border border-neutral-300 rounded px-3 py-2"
          >
            {ruleSets.map((rs) => (
              <option key={rs.id} value={rs.id}>
                {rs.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-neutral-600">先手AI</span>
          <select
            value={senteSlug}
            onChange={(e) => setSenteSlug(e.target.value)}
            className="border border-neutral-300 rounded px-3 py-2"
          >
            {profiles.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-neutral-600">後手AI</span>
          <select
            value={goteSlug}
            onChange={(e) => setGoteSlug(e.target.value)}
            className="border border-neutral-300 rounded px-3 py-2"
          >
            {profiles.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button
          disabled={busy}
          onClick={start}
          className="px-4 py-3 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          対局を開始して観戦する
        </button>

        <div className="border-t pt-4 flex flex-col gap-2">
          <span className="text-sm font-medium">自己対局バッチ生成(AI Stage3: データ収集用)</span>
          <p className="text-xs text-neutral-500">
            観戦せずに、上で選んだ2つのAIを指定局数まとめて対局させます(1局ずつ順番に実行するため、強いAI同士だと1局あたり数十秒〜数分かかることがあります)。結果は棋譜としてDBに保存され、レーティングにも反映されます。
          </p>
          <div className="flex items-center gap-2">
            <label className="text-sm text-neutral-600">局数</label>
            <input
              type="number"
              min={1}
              max={20}
              value={batchCount}
              onChange={(e) => setBatchCount(Number(e.target.value))}
              className="w-20 border border-neutral-300 rounded px-2 py-1"
            />
            <button
              disabled={batchBusy}
              onClick={runBatch}
              className="px-3 py-2 rounded border border-neutral-900 hover:bg-neutral-100 disabled:opacity-50 text-sm"
            >
              {batchBusy ? "実行中…" : "バッチ実行"}
            </button>
          </div>
          {batchError && <p className="text-red-600 text-sm">{batchError}</p>}
          {batchResults && (
            <ul className="text-xs text-neutral-600 flex flex-col gap-1">
              {batchResults.map((g) => (
                <li key={g.gameId}>
                  {g.gameId.slice(0, 8)}: {g.moveCount}手 / {g.result.status}
                  {g.result.winner ? `(${g.result.winner === "sente" ? "先手" : "後手"}勝ち)` : ""} /{" "}
                  {(g.durationMs / 1000).toFixed(1)}秒
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <button className="text-sm underline text-neutral-500" onClick={() => router.push("/")}>
        ロビーへ戻る
      </button>
    </main>
  );
}
