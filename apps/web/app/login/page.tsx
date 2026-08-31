"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(name, email, password);
      }
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-bold">{mode === "login" ? "ログイン" : "新規登録"}</h1>

      <form onSubmit={submit} className="flex flex-col gap-3 w-full max-w-sm">
        {mode === "register" && (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="表示名"
            required
            className="border border-neutral-300 rounded px-3 py-2"
          />
        )}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="メールアドレス"
          required
          className="border border-neutral-300 rounded px-3 py-2"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="パスワード(8文字以上)"
          required
          minLength={8}
          className="border border-neutral-300 rounded px-3 py-2"
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-3 rounded bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {mode === "login" ? "ログイン" : "登録する"}
        </button>
      </form>

      <button
        className="text-sm underline text-neutral-500"
        onClick={() => setMode(mode === "login" ? "register" : "login")}
      >
        {mode === "login" ? "アカウントを新規登録する" : "既にアカウントをお持ちの方はこちら"}
      </button>

      <button className="text-sm underline text-neutral-500" onClick={() => router.push("/")}>
        ログインせずに遊ぶ(ゲスト)
      </button>
    </main>
  );
}
