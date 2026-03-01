import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getApiBase } from "../services/syncConfig";

type AuthUser = {
  id: number;
  username: string;
  email?: string | null;
};

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  user: AuthUser | null;
  status: AuthStatus;
  displayName: string;
  login: (usernameOrEmail: string, password: string) => Promise<void>;
  register: (username: string, email: string | null, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const getOrCreateGuestName = (): string => {
  const key = "aura-guest-name";
  const existing = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
  if (existing && existing.trim()) return existing;
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? (crypto.randomUUID().replace(/-/g, "").slice(0, 4) || "GUEST").toUpperCase()
      : Math.random().toString(16).slice(2, 6).toUpperCase();
  const name = `Guest ${suffix}`;
  try {
    window.localStorage.setItem(key, name);
  } catch {}
  return name;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  const apiBase = getApiBase();

  const reload = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch(`${apiBase}/api/auth/me`, {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) {
        setUser(null);
        setStatus("unauthenticated");
        return;
      }
      const data = (await res.json()) as { user: AuthUser };
      setUser(data.user);
      setStatus("authenticated");
    } catch {
      setUser(null);
      setStatus("unauthenticated");
    }
  }, [apiBase]);

  useEffect(() => {
    reload();
  }, [reload]);

  const login = useCallback(
    async (usernameOrEmail: string, password: string) => {
      const res = await fetch(`${apiBase}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ usernameOrEmail, password }),
      });
      if (!res.ok) {
        let message = "登录失败";
        try {
          const data = await res.json();
          if (typeof data?.detail === "string") {
            message = data.detail;
          }
        } catch {}
        throw new Error(message);
      }
      const data = (await res.json()) as { user: AuthUser };
      setUser(data.user);
      setStatus("authenticated");
    },
    [apiBase],
  );

  const register = useCallback(
    async (username: string, email: string | null, password: string) => {
      const res = await fetch(`${apiBase}/api/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ username, email, password }),
      });
      if (!res.ok) {
        let message = "注册失败";
        try {
          const data = await res.json();
          if (typeof data?.detail === "string") {
            message = data.detail;
          }
        } catch {}
        throw new Error(message);
      }
      const data = (await res.json()) as { user: AuthUser };
      setUser(data.user);
      setStatus("authenticated");
    },
    [apiBase],
  );

  const logout = useCallback(async () => {
    try {
      await fetch(`${apiBase}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {}
    setUser(null);
    setStatus("unauthenticated");
  }, [apiBase]);

  const displayName = useMemo(() => {
    if (user) return user.username;
    return getOrCreateGuestName();
  }, [user]);

  const value: AuthContextValue = {
    user,
    status,
    displayName,
    login,
    register,
    logout,
    reload,
  };

  return React.createElement(AuthContext.Provider, { value }, children);
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
};
