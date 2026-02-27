import type { Song } from "../types";
import { getApiBase, getWsBase } from "./syncConfig";

export type RoomState = {
  revision: number;
  queue: Song[];
  originalQueue: Song[];
  playMode: number; // 0/1/2
  currentSongId: string | null;
  isPlaying: boolean;
  currentTime: number;
  timeUpdatedAt: number; // epoch ms
  clockClientId: string | null;
};

export type ServerMessage =
  | { type: "SNAPSHOT"; state: RoomState }
  | { type: "STATE"; state: RoomState };

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type RoomSyncClient = {
  clientId: string;
  status: ConnectionStatus;
  connect: () => void;
  disconnect: () => void;
  sendCommand: (command: string, payload?: Record<string, any>) => void;
};

const getOrCreateClientId = (): string => {
  const key = "aura-client-id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(key, id);
  return id;
};

export const computeEffectiveTime = (state: RoomState): number => {
  if (!state.isPlaying) return Math.max(0, state.currentTime || 0);
  const deltaMs = Math.max(0, Date.now() - (state.timeUpdatedAt || Date.now()));
  return Math.max(0, (state.currentTime || 0) + deltaMs / 1000);
};

export const fetchRoomSnapshot = async (roomId: string): Promise<RoomState> => {
  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}/api/rooms/${encodeURIComponent(roomId)}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to load room (${res.status}): ${text}`);
  }
  return (await res.json()) as RoomState;
};

export function createRoomSyncClient(params: {
  roomId: string;
  onState: (state: RoomState) => void;
  onStatus?: (status: ConnectionStatus) => void;
}): RoomSyncClient {
  const clientId = getOrCreateClientId();
  let ws: WebSocket | null = null;
  let status: ConnectionStatus = "disconnected";
  let retryTimer: number | null = null;
  let attempt = 0;

  const setStatus = (s: ConnectionStatus) => {
    status = s;
    params.onStatus?.(s);
  };

  const clearRetry = () => {
    if (retryTimer) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const buildWsUrl = () => {
    const wsBase = getWsBase();
    if (wsBase) return `${wsBase}/ws/rooms/${encodeURIComponent(params.roomId)}`;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}/ws/rooms/${encodeURIComponent(
      params.roomId,
    )}`;
  };

  const scheduleReconnect = () => {
    clearRetry();
    attempt += 1;
    const delay = Math.min(8000, 300 * Math.pow(1.6, attempt));
    retryTimer = window.setTimeout(() => {
      connect();
    }, delay);
  };

  const connect = () => {
    clearRetry();
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    setStatus("connecting");
    try {
      ws = new WebSocket(buildWsUrl());
    } catch (e) {
      setStatus("disconnected");
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      attempt = 0;
      setStatus("connected");
    };
    ws.onclose = () => {
      setStatus("disconnected");
      scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose will follow in most cases
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        if (msg?.type === "SNAPSHOT" || msg?.type === "STATE") {
          params.onState(msg.state);
        }
      } catch {
        // ignore
      }
    };
  };

  const disconnect = () => {
    clearRetry();
    attempt = 0;
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    ws = null;
    setStatus("disconnected");
  };

  const sendCommand = (command: string, payload?: Record<string, any>) => {
    const msg = { type: "COMMAND", clientId, command, payload: payload || {} };
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify(msg));
  };

  return {
    clientId,
    get status() {
      return status;
    },
    connect,
    disconnect,
    sendCommand,
  };
}

