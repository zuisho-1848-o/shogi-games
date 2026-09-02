"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AiProfileMeta,
  createCpuGame,
  createPrivateGame,
  fetchAiProfiles,
  joinPrivateGame,
  saveSession,
} from "../lib/api";
import { CATEGORY_LABEL, fetchRuleSets, RuleSetMeta } from "../lib/ruleSets";
import { OpponentPreference, useMatchmaking } from "../lib/useMatchmaking";
import { useAuth } from "../lib/auth";

const ALL_CATEGORIES: RuleSetMeta["category"][] = ["standard", "handicap", "special", "boardSize"];

const OPPONENT_PREFERENCE_LABEL: Record<OpponentPreference, string> = {
  human: "人間のみ",
  ai: "AIのみ",
  either: "どちらでも(人間優先、見つからなければAI)",
};

export default function LobbyPage() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ruleSets, setRuleSets] = useState<RuleSetMeta[]>([]);
  const [ruleSetId, setRuleSetId] = useState("standard");
  const [randomCategories, setRandomCategories] = useState<RuleSetMeta["category"][]>(ALL_CATEGORIES);
  const [aiProfiles, setAiProfiles] = useState<AiProfileMeta[]>([]);
  const [aiProfileSlug, setAiProfileSlug] = useState("ai_medium");
  const [opponentPreference, setOpponentPreference] = useState<OpponentPreference>("human");
  const [timeControlMinutes, setTimeControlMinutes] = useState<number>(0); // 0 = 時間無制限

  const matchmaking = useMatchmaking();

  useEffect(() => {
    fetchRuleSets()
      .then(setRuleSets)
      .catch((e) => setError(String(e)));
    fetchAiProfiles()
      .then(setAiProfiles)
      .catch(() => {});
  }, []);

  const startCpuGame = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await createCpuGame(
        "sente",
        ruleSetId,
        aiProfileSlug,
        timeControlMinutes > 0 ? timeControlMinutes * 60_000 : undefined
      );
      saveSession(res.gameId, { playerToken: res.playerToken, yourColor: res.yourColor });
      router.push(`/game/${res.gameId}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const startPrivateGame = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await createPrivateGame(
        "sente",
        ruleSetId,
        timeControlMinutes > 0 ? timeControlMinutes * 60_000 : undefined
      );
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

  const joinGame = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await joinPrivateGame(joinCode.trim());
      saveSession(res.gameId, { playerToken: res.playerToken, yourColor: res.yourColor });
      router.push(`/game/${res.gameId}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleCategory = (category: RuleSetMeta["category"]) => {
    setRandomCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category]
    );
  };

  const grouped = ruleSets.reduce<Record<string, RuleSetMeta[]>>((acc, rs) => {
    (acc[rs.category] ??= []).push(rs);
    return acc;
  }, {});

  const isMatching = matchmaking.status === "waiting";

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 p-8">
      <div className="w-full max-w-md flex items-center justify-between text-sm">
        {user ? (
          <>
            <span>
              {user.name} <span className="text-neutral-500">(レート {user.rating})</span>
            </span>
            <button className="underline text-neutral-500" onClick={logout}>
              ログアウト
            </button>
          </>
        ) : (
          <>
            <span className="text-neutral-500">ゲストとしてプレイ中</span>
            <button className="underline" onClick={() => router.push("/login")}>
              ログイン / 新規登録
            </button>
          </>
        )}
      </div>

      <h1 className="text-3xl font-bold">将棋バリアント対戦（MVP）</h1>

      <div className="flex gap-4 text-sm">
        <button className="underline text-neutral-500" onClick={() => router.push("/leaderboard")}>
          レーティング一覧
        </button>
        <button className="underline text-neutral-500" onClick={() => router.push("/ai-arena")}>
          AI同士の対局を観戦
        </button>
        <button className="underline text-neutral-500" onClick={() => router.push("/puzzles")}>
          詰将棋
        </button>
        <button className="underline text-neutral-500" onClick={() => router.push("/history")}>
          対局履歴
        </button>
      </div>

      <div className="flex flex-col gap-4 w-full max-w-md">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-neutral-600">ルールセット</span>
          <select
            value={ruleSetId}
            onChange={(e) => setRuleSetId(e.target.value)}
            className="border border-neutral-300 rounded px-3 py-2"
          >
            {Object.entries(grouped).map(([category, items]) => (
              <optgroup key={category} label={CATEGORY_LABEL[category as RuleSetMeta["category"]] ?? category}>
                {items.map((rs) => (
                  <option key={rs.id} value={rs.id}>
                    {rs.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {ruleSets.find((rs) => rs.id === ruleSetId) && (
            <span className="text-xs text-neutral-500">
              {ruleSets.find((rs) => rs.id === ruleSetId)?.description}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-neutral-600">CPU戦の強さ</span>
          <select
            value={aiProfileSlug}
            onChange={(e) => setAiProfileSlug(e.target.value)}
            className="border border-neutral-300 rounded px-3 py-2"
          >
            {aiProfiles.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-neutral-600">持ち時間(CPU戦・プライベートマッチ共通)</span>
          <select
            value={timeControlMinutes}
            onChange={(e) => setTimeControlMinutes(Number(e.target.value))}
            className="border border-neutral-300 rounded px-3 py-2"
          >
            <option value={0}>時間無制限</option>
            <option value={3}>3分切れ負け</option>
            <option value={5}>5分切れ負け</option>
            <option value={10}>10分切れ負け</option>
            <option value={30}>30分切れ負け</option>
          </select>
        </label>

        <button
          disabled={busy}
          onClick={startCpuGame}
          className="px-4 py-3 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          CPU戦を始める（先手）
        </button>

        <button
          disabled={busy}
          onClick={startPrivateGame}
          className="px-4 py-3 rounded border border-neutral-900 hover:bg-neutral-100 disabled:opacity-50"
        >
          プライベートマッチを作成する
        </button>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-neutral-600">マッチング時の対戦相手タイプ</span>
          <select
            value={opponentPreference}
            onChange={(e) => setOpponentPreference(e.target.value as OpponentPreference)}
            disabled={isMatching}
            className="border border-neutral-300 rounded px-3 py-2"
          >
            {(Object.keys(OPPONENT_PREFERENCE_LABEL) as OpponentPreference[]).map((p) => (
              <option key={p} value={p}>
                {OPPONENT_PREFERENCE_LABEL[p]}
              </option>
            ))}
          </select>
        </label>

        <button
          disabled={isMatching}
          onClick={() => matchmaking.joinCasual(ruleSetId, opponentPreference, aiProfileSlug)}
          className="px-4 py-3 rounded border border-blue-700 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
        >
          カジュアルマッチを探す（選択中のルールで即マッチング）
        </button>

        <button
          onClick={() => router.push("/setup")}
          className="px-4 py-3 rounded border border-dashed border-neutral-400 hover:bg-neutral-100 text-sm"
        >
          自由配置で対局する（自陣を自分でカスタマイズ）
        </button>

        <div className="flex gap-2">
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="ルームコード(6桁)"
            className="flex-1 border border-neutral-300 rounded px-3 py-2"
          />
          <button
            disabled={busy || joinCode.trim().length === 0}
            onClick={joinGame}
            className="px-4 py-2 rounded border border-neutral-900 hover:bg-neutral-100 disabled:opacity-50"
          >
            参加
          </button>
        </div>

        <div className="border-t pt-4 flex flex-col gap-2">
          <span className="text-sm font-medium">ランダムルールオンラインマッチング</span>
          <span className="text-xs text-neutral-500">
            許容できるルールの範囲を選び、同じ範囲を許容する相手が見つかったらランダムなルールで対局が始まります。上の「対戦相手タイプ」もここに適用されます。
          </span>
          <div className="flex gap-3 flex-wrap">
            {ALL_CATEGORIES.map((c) => (
              <label key={c} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={randomCategories.includes(c)}
                  onChange={() => toggleCategory(c)}
                  disabled={isMatching}
                />
                {CATEGORY_LABEL[c]}
              </label>
            ))}
          </div>
          <button
            disabled={isMatching || randomCategories.length === 0}
            onClick={() => matchmaking.joinRandom(randomCategories, opponentPreference, aiProfileSlug)}
            className="px-4 py-3 rounded border border-purple-700 text-purple-700 hover:bg-purple-50 disabled:opacity-50"
          >
            ランダムルールでマッチングする
          </button>
        </div>

        {isMatching && (
          <div className="flex items-center justify-between bg-amber-100 px-4 py-2 rounded">
            <span className="text-sm text-amber-800">マッチング中…相手を探しています</span>
            <button className="text-sm underline" onClick={matchmaking.cancel}>
              キャンセル
            </button>
          </div>
        )}

        {matchmaking.error && <p className="text-red-600 text-sm">マッチングエラー: {matchmaking.error}</p>}
        {error && <p className="text-red-600 text-sm">{error}</p>}
      </div>
    </main>
  );
}
