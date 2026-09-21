import type { Song } from "../types";
import { getApiBase, getWsBase } from "./syncConfig";

export type RoomState = {
  revision: number;
  queue: Song[];
  originalQueue: Song[];
  playMode: number;
  currentSongId: string | null;
  isPlaying: boolean;
  currentTime: number;
  timeUpdatedAt: number;
  clockClientId: string | null;
  creatorUserId?: number | null;
  creatorName?: string | null;
  duration?: number;
  permissions?: RoomPermissions;
};

export type RoomRole = "creator" | "member" | "guest";
export type PermCategory = "control" | "edit";

// The host is never restricted; these flags cover everyone else. Missing
// fields mean "allowed" so rooms stored before permissions existed keep
// their open behavior.
export type RoomPermissions = {
  guest: { control: boolean; edit: boolean };
  member: { control: boolean; edit: boolean };
};

export const DEFAULT_PERMISSIONS: RoomPermissions = {
  guest: { control: true, edit: true },
  member: { control: true, edit: true },
};

export const resolveRoomRole = (
  creatorId: number | null | undefined,
  userId: number | null | undefined,
): RoomRole => {
  if (userId != null && creatorId != null && creatorId === userId) return "creator";
  if (userId != null) return "member";
  return "guest";
};

export const permissionAllows = (
  permissions: RoomPermissions | null | undefined,
  role: RoomRole,
  category: PermCategory,
): boolean => {
  if (role === "creator") return true;
  const section = permissions?.[role];
  if (!section) return true;
  return section[category];
};

export type RoomViewer = {
  userId: number | null;
  displayName: string;
  isGuest: boolean;
  isCreator?: boolean;
};

export type ViewersMessage = {
  type: "VIEWERS";
  creator: RoomViewer | null;
  viewers: RoomViewer[];
};

export type ServerMessage =
  | { type: "SNAPSHOT"; state: RoomState }
  | { type: "STATE"; state: RoomState }
  | ViewersMessage
  | { type: "ERROR"; code: string };

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

// Custom websocket close codes surfaced by the backend.
export const WS_ROOM_MISSING_CODE = 4404;
export const WS_ROOM_DELETED_CODE = 4405;

export class RoomMissingError extends Error {
  constructor(roomId: string) {
    super(`Room "${roomId}" does not exist`);
    this.name = "RoomMissingError";
  }
}

export const ROOM_KEY = "aura-room-id";

export type RoomTarget = { id: string | null };

// Shared with the backend's ROOM_ID_RE: 3-64 chars of letters, digits, - or _.
export const ROOM_ID_RE = /^[a-zA-Z0-9_-]{3,64}$/;

// The URL is the single source of truth for the active room: the address bar
// always shows it. There is no implicit room — visiting the bare domain lands
// on the guide page; joining or creating a room navigates to ?room=<id>.
export const resolveRoomId = (search: string): RoomTarget => {
  const fromUrl = new URLSearchParams(search).get("room");
  if (fromUrl && fromUrl.trim()) return { id: fromUrl.trim() };
  return { id: null };
};

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
    if (res.status === 404) {
      throw new RoomMissingError(roomId);
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to load room (${res.status}): ${text}`);
  }
  return (await res.json()) as RoomState;
};

export const createRoom = async (roomId: string): Promise<void> => {
  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ roomId }),
  });
  if (!res.ok) {
    const err = new Error(`Failed to create room (${res.status})`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
};

export const deleteRoom = async (roomId: string): Promise<void> => {
  const apiBase = getApiBase();
  const res = await fetch(
    `${apiBase}/api/rooms/${encodeURIComponent(roomId)}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!res.ok) {
    const err = new Error(`Failed to delete room (${res.status})`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
};

export function createRoomSyncClient(params: {
  roomId: string;
  onState: (state: RoomState) => void;
  onStatus?: (status: ConnectionStatus) => void;
  onViewers?: (msg: ViewersMessage) => void;
  onMissing?: () => void;
  onDeleted?: () => void;
  onDenied?: () => void;
  displayName?: string;
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
    const encodedRoom = encodeURIComponent(params.roomId);
    const nameQuery =
      params.displayName && params.displayName.trim().length > 0
        ? `?displayName=${encodeURIComponent(params.displayName)}`
        : "";
    const wsBase = getWsBase();
    if (wsBase) return `${wsBase}/ws/rooms/${encodedRoom}${nameQuery}`;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}/ws/rooms/${encodedRoom}${nameQuery}`;
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
    ws.onclose = (event) => {
      setStatus("disconnected");
      if (event.code === WS_ROOM_MISSING_CODE) {
        params.onMissing?.();
        return;
      }
      if (event.code === WS_ROOM_DELETED_CODE) {
        params.onDeleted?.();
      }
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
        } else if (msg?.type === "VIEWERS") {
          params.onViewers?.(msg);
        } else if (msg?.type === "ERROR" && msg?.code === "ROOM_NOT_FOUND") {
          params.onMissing?.();
        } else if (msg?.type === "ERROR" && msg?.code === "ROOM_DELETED") {
          params.onDeleted?.();
        } else if (msg?.type === "ERROR" && msg?.code === "PERMISSION_DENIED") {
          params.onDenied?.();
        }
      } catch {
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

