import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../hooks/useI18n";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../hooks/useToast";
import { getApiBase } from "../services/syncConfig";
import { SettingsIcon } from "./Icons";

type Tab = "general" | "users" | "rooms";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Cfg {
  allowRegister: boolean;
  allowUpload: boolean;
  allowGuestUpload: boolean;
  allowRoomCreate: boolean;
}

interface AdminUser {
  id: number;
  username: string;
  email: string | null;
  role: string;
  created_at: number;
}

interface AdminRoom {
  roomId: string;
  revision: number;
  creatorUserId: number | null;
  creatorName: string | null;
  songCount: number;
  isPlaying: boolean;
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose }) => {
  const { dict } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const apiBase = getApiBase();
  const s = dict.settings;

  const [tab, setTab] = useState<Tab>("general");
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [rooms, setRooms] = useState<AdminRoom[] | null>(null);
  const [confirmId, setConfirmId] = useState<string | number | null>(null);

  const fetchJson = async (url: string, opts?: RequestInit) => {
    const res = await fetch(`${apiBase}${url}`, { credentials: "include", ...opts });
    if (!res.ok) {
      let message = s.fail;
      try {
        const data = await res.json();
        if (typeof data?.detail === "string") message = data.detail;
      } catch {}
      throw new Error(message);
    }
    return res.json();
  };

  const failToast = (err: unknown) => {
    toast.error(err instanceof Error ? err.message : s.fail);
  };

  const loadConfig = async () => {
    try {
      setCfg(await fetchJson("/api/admin/config"));
    } catch (err) {
      toast.error(s.loadFail);
    }
  };

  const loadUsers = async () => {
    try {
      const data = await fetchJson("/api/admin/users");
      setUsers(data.users);
    } catch {
      setUsers([]);
      toast.error(s.loadFail);
    }
  };

  const loadRooms = async () => {
    try {
      const data = await fetchJson("/api/admin/rooms");
      setRooms(data.rooms);
    } catch {
      setRooms([]);
      toast.error(s.loadFail);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setTab("general");
    setConfirmId(null);
    loadConfig();
  }, [isOpen]);

  const openTab = (next: Tab) => {
    setTab(next);
    setConfirmId(null);
    if (next === "users") loadUsers();
    if (next === "rooms") loadRooms();
  };

  const saveToggle = async (key: keyof Cfg, value: boolean) => {
    if (!cfg) return;
    const prev = cfg;
    setCfg({ ...cfg, [key]: value });
    try {
      const next = await fetchJson("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      setCfg(next);
      toast.success(s.saved);
    } catch (err) {
      setCfg(prev);
      failToast(err);
    }
  };

  const removeUser = async (u: AdminUser) => {
    if (confirmId !== u.id) {
      setConfirmId(u.id);
      return;
    }
    setConfirmId(null);
    try {
      await fetchJson(`/api/admin/users/${u.id}`, { method: "DELETE" });
      setUsers((list) => (list ?? []).filter((x) => x.id !== u.id));
      toast.success(s.saved);
    } catch (err) {
      failToast(err);
    }
  };

  const removeRoom = async (r: AdminRoom) => {
    if (confirmId !== r.roomId) {
      setConfirmId(r.roomId);
      return;
    }
    setConfirmId(null);
    try {
      await fetchJson(`/api/admin/rooms/${r.roomId}`, { method: "DELETE" });
      setRooms((list) => (list ?? []).filter((x) => x.roomId !== r.roomId));
      toast.success(s.saved);
    } catch (err) {
      failToast(err);
    }
  };

  if (!isOpen) return null;

  const fmtDate = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });

  const menu: Array<{ key: Tab; label: string }> = [
    { key: "general", label: s.general },
    { key: "users", label: s.users },
    { key: "rooms", label: s.rooms },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center px-4 select-none">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="dialog-in relative w-full max-w-3xl h-[540px] max-h-[90vh] bg-black/40 backdrop-blur-2xl saturate-150 border border-white/10 rounded-[28px] shadow-[0_30px_80px_rgba(0,0,0,0.45)] overflow-hidden ring-1 ring-white/5 flex text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          @keyframes modal-in {
            0% { opacity: 0; transform: scale(0.96) translateY(-8px); }
            100% { opacity: 1; transform: scale(1) translateY(0); }
          }
          .dialog-in { animation: modal-in 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; will-change: transform, opacity; }
        `}</style>

        {/* Left menu */}
        <div className="w-44 shrink-0 border-r border-white/10 bg-white/[0.03] p-3 flex flex-col">
          <div className="flex items-center gap-2 px-2 pt-2 pb-4">
            <SettingsIcon className="w-4 h-4 text-white/60" />
            <span className="text-sm font-semibold text-white/90">{s.title}</span>
          </div>
          {menu.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => openTab(item.key)}
              className={`text-left text-sm px-3 py-2.5 rounded-xl transition-colors ${
                tab === item.key
                  ? "bg-white/15 text-white font-medium"
                  : "text-white/60 hover:bg-white/5 hover:text-white/90"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Right content */}
        <div className="relative flex-1 min-w-0 flex flex-col">
          <div className="flex items-center justify-between px-6 pt-5 pb-3">
            <h3 className="text-base font-semibold text-white/90">
              {menu.find((item) => item.key === tab)?.label}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors flex items-center justify-center"
              title="✕"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {tab === "general" && (
              <div className="space-y-3">
                <ToggleRow
                  label={s.allowRegister}
                  desc={s.allowRegisterDesc}
                  value={cfg?.allowRegister ?? true}
                  disabled={!cfg}
                  onChange={(v) => saveToggle("allowRegister", v)}
                />
                <ToggleRow
                  label={s.allowUpload}
                  desc={s.allowUploadDesc}
                  value={cfg?.allowUpload ?? true}
                  disabled={!cfg}
                  onChange={(v) => saveToggle("allowUpload", v)}
                />
                <ToggleRow
                  label={s.allowGuestUpload}
                  desc={s.allowGuestUploadDesc}
                  value={cfg?.allowGuestUpload ?? false}
                  disabled={!cfg || !cfg.allowUpload}
                  onChange={(v) => saveToggle("allowGuestUpload", v)}
                />
                <ToggleRow
                  label={s.allowRoomCreate}
                  desc={s.allowRoomCreateDesc}
                  value={cfg?.allowRoomCreate ?? false}
                  disabled={!cfg}
                  onChange={(v) => saveToggle("allowRoomCreate", v)}
                />
              </div>
            )}

            {tab === "users" && (
              users && users.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-white/40">
                        <th className="py-2 pr-4 font-medium">{s.colId}</th>
                        <th className="py-2 pr-4 font-medium">{s.colUser}</th>
                        <th className="py-2 pr-4 font-medium">{s.colEmail}</th>
                        <th className="py-2 pr-4 font-medium">{s.colRole}</th>
                        <th className="py-2 pr-4 font-medium">{s.colJoined}</th>
                        <th className="py-2 font-medium text-right">{s.colActions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id} className="border-t border-white/5 text-white/80">
                          <td className="py-2.5 pr-4 text-white/40">{u.id}</td>
                          <td className="py-2.5 pr-4">
                            {u.username}
                            {u.id === user?.id && (
                              <span className="ml-1.5 text-[10px] text-white/40">{s.you}</span>
                            )}
                          </td>
                          <td className="py-2.5 pr-4 max-w-[160px] truncate">
                            {u.email || <span className="text-white/25">{s.noEmail}</span>}
                          </td>
                          <td className="py-2.5 pr-4">
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded-full ${
                                u.role === "admin"
                                  ? "bg-amber-400/15 text-amber-300"
                                  : "bg-white/10 text-white/60"
                              }`}
                            >
                              {u.role === "admin" ? s.admin : s.user}
                            </span>
                          </td>
                          <td className="py-2.5 pr-4 text-white/50 whitespace-nowrap">{fmtDate(u.created_at)}</td>
                          <td className="py-2.5 text-right">
                            <button
                              type="button"
                              disabled={u.id === user?.id}
                              onClick={() => removeUser(u)}
                              className={`text-xs px-3 py-1.5 rounded-full transition-colors disabled:opacity-25 disabled:cursor-not-allowed ${
                                confirmId === u.id
                                  ? "bg-red-500/80 text-white"
                                  : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
                              }`}
                            >
                              {confirmId === u.id ? s.confirm : s.delete}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-white/40 py-10 text-center">{s.empty}</p>
              )
            )}

            {tab === "rooms" && (
              rooms && rooms.length > 0 ? (
                <div className="space-y-2.5">
                  {rooms.map((r) => (
                    <div
                      key={r.roomId}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm text-white/90">{r.roomId}</span>
                          {r.isPlaying && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-400/15 text-emerald-300">
                              {s.playing}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-white/45 mt-0.5 truncate">
                          {s.host}: {r.creatorName || "—"} · {s.songs(r.songCount)}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <a
                          href={`/?room=${r.roomId}`}
                          className="text-xs px-3 py-1.5 rounded-full bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition-colors"
                        >
                          {s.enter}
                        </a>
                        <button
                          type="button"
                          onClick={() => removeRoom(r)}
                          className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                            confirmId === r.roomId
                              ? "bg-red-500/80 text-white"
                              : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
                          }`}
                        >
                          {confirmId === r.roomId ? s.confirm : s.delete}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-white/40 py-10 text-center">{s.empty}</p>
              )
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

interface ToggleRowProps {
  label: string;
  desc: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

const ToggleRow: React.FC<ToggleRowProps> = ({ label, desc, value, disabled, onChange }) => (
  <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5">
    <div className="min-w-0">
      <div className="text-sm font-medium text-white/85">{label}</div>
      <div className="text-xs text-white/45 mt-0.5">{desc}</div>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
        value ? "bg-emerald-500/80" : "bg-white/15"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
          value ? "translate-x-5" : ""
        }`}
      />
    </button>
  </div>
);

export default SettingsDialog;
