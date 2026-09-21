import React from "react";
import { useI18n } from "../hooks/useI18n";
import { useToast } from "../hooks/useToast";
import SmartImage from "./SmartImage";
import { LinkIcon } from "./Icons";
import type { ConnectionStatus, RoomViewer } from "../services/roomSync";
import type { Song } from "../types";

interface RoomLobbyProps {
  roomId: string;
  status: ConnectionStatus;
  creator: RoomViewer | null;
  viewers: RoomViewer[];
  song: Song | null;
  queue: Song[];
  playing: boolean;
  missing?: boolean;
  deleted?: boolean;
  onEnter: () => void;
  onLeave: () => void;
}

const statusDot: Record<ConnectionStatus, string> = {
  connected: "bg-emerald-400",
  connecting: "bg-amber-400 animate-pulse",
  disconnected: "bg-white/40",
};

const RoomLobby: React.FC<RoomLobbyProps> = ({
  roomId,
  status,
  creator,
  viewers,
  song,
  queue,
  playing,
  missing = false,
  deleted = false,
  onEnter,
  onLeave,
}) => {
  const { dict } = useI18n();
  const { toast } = useToast();

  const goneTitle = deleted ? dict.room.deleted : dict.room.missing;
  const goneDesc = deleted ? dict.room.deletedDesc : dict.room.missingDesc;

  const statusLabel =
    status === "connected"
      ? dict.room.connected
      : status === "connecting"
        ? dict.room.connecting
        : dict.room.disconnected;

  const copyInvite = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    try {
      await navigator.clipboard.writeText(url.toString());
      toast.success(dict.room.copied);
    } catch {
      toast.error(dict.room.copyFail);
    }
  };

  if (missing || deleted) {
    return (
      <div className="flex-1 relative z-30 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-black/30 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 sm:p-8 text-white shadow-2xl">
          <div className="flex items-center gap-2 text-xs text-white/70">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            {goneTitle}
          </div>

          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            {goneTitle}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-white/60">
            {goneDesc}
          </p>

          <div className="mt-5 rounded-2xl bg-white/5 border border-white/10 px-4 py-3">
            <div className="text-[11px] uppercase tracking-widest text-white/40 mb-1">
              {dict.room.id}
            </div>
            <span className="font-mono text-lg text-white/90 truncate block">
              {roomId}
            </span>
          </div>

          <button
            type="button"
            onClick={onLeave}
            className="mt-6 w-full py-3.5 rounded-2xl text-sm font-semibold bg-white text-black hover:bg-white/90 active:scale-[0.99] transition-all shadow-lg"
          >
            {dict.room.home}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative z-30 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-black/30 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 sm:p-8 text-white shadow-2xl">
        <div className="flex items-center gap-2 text-xs text-white/70">
          <span className={`w-2 h-2 rounded-full ${statusDot[status]}`} />
          {statusLabel}
        </div>

        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          {dict.room.title}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-white/60">
          {dict.room.subtitle}
        </p>

        <div className="mt-5 rounded-2xl bg-white/5 border border-white/10 px-4 py-3">
          <div className="text-[11px] uppercase tracking-widest text-white/40 mb-1">
            {dict.room.id}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-lg text-white/90 truncate">
              {roomId}
            </span>
            <button
              type="button"
              onClick={copyInvite}
              className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-3 py-1.5 transition-colors shrink-0"
            >
              <LinkIcon className="w-3.5 h-3.5" />
              {dict.room.share}
            </button>
          </div>
        </div>

        {creator && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-white/50">{dict.room.creator}</span>
            <span className="text-white/90">{creator.displayName}</span>
          </div>
        )}

        {viewers.length > 0 && (
          <div className="mt-4">
            <div className="text-sm text-white/50 mb-2">
              {dict.room.viewers(viewers.length)}
            </div>
            <div className="flex flex-wrap gap-2">
              {viewers.map((viewer, idx) => (
                <span
                  key={`${viewer.displayName}-${idx}`}
                  className="px-2.5 py-1 rounded-full bg-white/10 text-xs text-white/80"
                >
                  {viewer.displayName}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 rounded-2xl bg-white/5 border border-white/10 p-3 flex items-center gap-3">
          {song?.coverUrl ? (
            <div className="relative w-12 h-12 rounded-xl overflow-hidden shrink-0 border border-white/10">
              <SmartImage
                src={song.coverUrl}
                containerClassName="absolute inset-0"
                imgClassName="w-full h-full object-cover"
                targetWidth={96}
                targetHeight={96}
                loading="eager"
              />
            </div>
          ) : (
            <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/30 shrink-0">
              ♪
            </div>
          )}
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-widest text-white/40">
              {song ? (playing ? dict.room.playing : dict.room.paused) : dict.room.idle}
            </div>
            <div className="text-sm text-white/90 truncate">
              {song ? `${song.title} - ${song.artist}` : dict.app.selectSong}
            </div>
          </div>
        </div>

        {queue.length > 0 && (
          <div className="mt-2.5 text-xs text-white/50">
            {dict.room.queue(queue.length)}
          </div>
        )}

        <button
          type="button"
          onClick={onEnter}
          className="mt-6 w-full py-3.5 rounded-2xl text-sm font-semibold bg-white text-black hover:bg-white/90 active:scale-[0.99] transition-all shadow-lg"
        >
          {dict.room.enter}
        </button>
        <button
          type="button"
          onClick={onLeave}
          className="mt-3 w-full text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          {dict.room.home}
        </button>
      </div>
    </div>
  );
};

export default RoomLobby;
