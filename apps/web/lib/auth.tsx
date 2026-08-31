"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { SERVER_URL } from "./api";

export interface AuthUser {
  id: string;
  name: string;
  rating: number;
  isAi: boolean;
  gamesPlayed: number;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const STORAGE_KEY = "shogi-games:auth";

const AuthContext = createContext<AuthContextValue | null>(null);

const loadStored = (): AuthState => {
  if (typeof window === "undefined") return { token: null, user: null };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { token: null, user: null };
  } catch {
    return { token: null, user: null };
  }
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<AuthState>({ token: null, user: null });

  useEffect(() => {
    setState(loadStored());
  }, []);

  const persist = (next: AuthState) => {
    setState(next);
    if (next.token && next.user) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  };

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch(`${SERVER_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error === "invalid_credentials" ? "メールアドレスまたはパスワードが違います" : "ログインに失敗しました");
    }
    const data = await res.json();
    persist({ token: data.token, user: data.user });
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const res = await fetch(`${SERVER_URL}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error === "email_taken" ? "このメールアドレスは既に登録されています" : body.message ?? "登録に失敗しました");
    }
    const data = await res.json();
    persist({ token: data.token, user: data.user });
  }, []);

  const logout = useCallback(() => {
    persist({ token: null, user: null });
  }, []);

  const refresh = useCallback(async () => {
    const current = loadStored();
    if (!current.token) return;
    const res = await fetch(`${SERVER_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${current.token}` },
    });
    if (!res.ok) {
      persist({ token: null, user: null });
      return;
    }
    const data = await res.json();
    persist({ token: current.token, user: data.user });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, refresh }}>{children}</AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

export const getStoredToken = (): string | null => loadStored().token;
