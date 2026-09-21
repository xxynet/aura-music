import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getApiBase } from "../services/syncConfig";

type AuthUser = {
  id: number;
  username: string;
  email?: string | null;
  role?: string;
};

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type StatusPayload = { user: AuthUser | null; initialized: boolean };

// Access tokens are short-lived server-side; this keeps them renewed well
// before they expire without any visible activity.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

type AuthContextValue = {
  user: AuthUser | null;
  status: AuthStatus;
  displayName: string;
  needsInit: boolean;
  login: (usernameOrEmail: string, password: string) => Promise<void>;
  register: (username: string, email: string | null, password: string) => Promise<void>;
  initAdmin: (username: string, email: string | null, password: string) => Promise<void>;
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
  const [needsInit, setNeedsInit] = useState(false);
  const inflight = useRef<Promise<AuthUser | null> | null>(null);

  const apiBase = getApiBase();

  const applyStatus = useCallback((payload: StatusPayload): AuthUser | null => {
    setUser(payload.user);
    setNeedsInit(!payload.initialized);
    setStatus(payload.user ? "authenticated" : "unauthenticated");
    return payload.user;
  }, []);

  const refresh = useCallback(async (): Promise<AuthUser | null> => {
    if (inflight.current) return inflight.current;
    const task = (async () => {
      let res: Response;
      try {
        res = await fetch(`${apiBase}/api/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
      } catch {
        // Transient network issue; keep the current session state.
        return null;
      }
      if (res.ok) {
        const data = (await res.json()) as { user: AuthUser };
        setUser(data.user);
        setNeedsInit(false);
        setStatus("authenticated");
        return data.user;
      }
      // The refresh token was rejected. Another tab may have rotated it, in
      // which case the shared cookie jar already holds a valid access token,
      // so re-check before declaring the session dead.
      try {
        const statusRes = await fetch(`${apiBase}/api/auth/status`, {
          credentials: "include",
        });
        if (!statusRes.ok) return null;
        return applyStatus((await statusRes.json()) as StatusPayload);
      } catch {
        return null;
      }
    })().finally(() => {
      inflight.current = null;
    });
    inflight.current = task;
    return task;
  }, [apiBase, applyStatus]);

  const reload = useCallback(async () => {
    setStatus("loading");
    let payload: StatusPayload | null = null;
    try {
      const res = await fetch(`${apiBase}/api/auth/status`, {
        method: "GET",
        credentials: "include",
      });
      if (res.ok) {
        payload = (await res.json()) as StatusPayload;
      }
    } catch {}
    if (!payload) {
      setUser(null);
      setNeedsInit(false);
      setStatus("unauthenticated");
      return;
    }
    if (payload.user) {
      applyStatus(payload);
      return;
    }
    // The access token may simply have expired; the long-lived refresh
    // cookie can still restore the session without a re-login.
    if (await refresh()) return;
    applyStatus(payload);
  }, [apiBase, applyStatus, refresh]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (status !== "authenticated") return;
    const timer = window.setInterval(() => {
      refresh();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [status, refresh]);

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
      setNeedsInit(false);
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
      setNeedsInit(false);
      setStatus("authenticated");
    },
    [apiBase],
  );

  const initAdmin = useCallback(
    async (username: string, email: string | null, password: string) => {
      const res = await fetch(`${apiBase}/api/auth/init-admin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ username, email, password }),
      });
      if (!res.ok) {
        let message = "管理员初始化失败";
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
      setNeedsInit(false);
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
    needsInit,
    login,
    register,
    initAdmin,
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
