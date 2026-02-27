import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Song, LyricLine } from "../types";
import { PlayMode, PlayState } from "../types";
import { parseLyrics } from "../services/lyrics";
import { extractColors, parseAudioMetadata, parseNeteaseLink } from "../services/utils";
import {
  fetchNeteasePlaylist,
  fetchNeteaseSong,
  getNeteaseAudioUrl,
  fetchLyricsById,
  searchAndMatchLyrics,
} from "../services/lyricsService";
import { computeEffectiveTime, createRoomSyncClient, fetchRoomSnapshot, RoomState } from "../services/roomSync";
import { dataUrlToFile, uploadFile } from "../services/upload";

type MatchStatus = "idle" | "matching" | "success" | "failed";

type SongExtras = {
  lyrics?: LyricLine[];
  colors?: string[];
  needsLyricsMatch?: boolean;
};

const getRoomId = (): string => {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("room");
  const key = "aura-room-id";
  if (fromUrl && fromUrl.trim()) {
    localStorage.setItem(key, fromUrl.trim());
    return fromUrl.trim();
  }
  const fromStorage = localStorage.getItem(key);
  if (fromStorage && fromStorage.trim()) return fromStorage.trim();
  const fallback = "demo";
  localStorage.setItem(key, fallback);
  return fallback;
};

const stripSongForSync = (song: Song): Song => {
  // Do not sync heavy/device-specific fields (lyrics/colors/needsLyricsMatch)
  const { lyrics, colors, needsLyricsMatch, ...rest } = song as any;
  return rest as Song;
};

export function useRoom() {
  const roomId = useMemo(() => getRoomId(), []);
  const [connectionStatus, setConnectionStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");

  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const lastRevisionRef = useRef<number>(-1);

  const [extras, setExtras] = useState<Record<string, SongExtras>>({});
  const [matchStatus, setMatchStatus] = useState<MatchStatus>("idle");

  const audioRef = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState(0);
  const [localTime, setLocalTime] = useState(0);

  const client = useMemo(() => {
    return createRoomSyncClient({
      roomId,
      onState: (s) => {
        if (typeof s?.revision === "number" && s.revision <= lastRevisionRef.current) {
          return;
        }
        lastRevisionRef.current = s.revision ?? lastRevisionRef.current;
        setRoomState(s);
      },
      onStatus: setConnectionStatus,
    });
  }, [roomId]);

  useEffect(() => {
    let cancelled = false;
    fetchRoomSnapshot(roomId)
      .then((snap) => {
        if (cancelled) return;
        lastRevisionRef.current = snap.revision ?? -1;
        setRoomState(snap);
      })
      .catch(() => {
        // ignore (WS will likely provide snapshot too)
      });
    client.connect();
    return () => {
      cancelled = true;
      client.disconnect();
    };
  }, [client, roomId]);

  const queue = roomState?.queue ?? [];
  const originalQueue = roomState?.originalQueue ?? [];
  const playMode = (roomState?.playMode ?? 0) as PlayMode;
  const currentSongId = roomState?.currentSongId ?? null;
  const isPlaying = !!roomState?.isPlaying;

  const mergedQueue: Song[] = useMemo(() => {
    return queue.map((song) => {
      const extra = extras[song.id];
      return {
        ...song,
        lyrics: extra?.lyrics,
        colors: extra?.colors,
        needsLyricsMatch: extra?.needsLyricsMatch,
      };
    });
  }, [queue, extras]);

  const currentIndex = useMemo(() => {
    if (!currentSongId) return -1;
    return mergedQueue.findIndex((s) => s.id === currentSongId);
  }, [mergedQueue, currentSongId]);

  const currentSong = currentIndex >= 0 ? mergedQueue[currentIndex] : null;
  const accentColor = currentSong?.colors?.[0] || "#a855f7";

  const effectiveTime = roomState ? computeEffectiveTime(roomState) : 0;

  // Drive audio element to follow authoritative state
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !roomState) return;

    // If song changed, reset local time to avoid UI showing old time briefly
    setLocalTime(effectiveTime);

    // Sync play/pause
    if (roomState.isPlaying) {
      audio
        .play()
        .catch(() => {
          // Autoplay can be blocked; we still keep state synced.
        });
    } else {
      audio.pause();
    }

    // Drift correction (also handles SEEK)
    const desired = effectiveTime;
    const actual = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const drift = Math.abs(actual - desired);
    const shouldHardSync =
    // TODO: make this configurable
      drift > 1.0 || // large drift
      (desired < 0.2 && actual > 1.0); // song change / reset
    if (shouldHardSync && Number.isFinite(desired)) {
      try {
        audio.currentTime = Math.max(0, desired);
      } catch {
        // ignore
      }
    }
  }, [roomState?.currentSongId, roomState?.isPlaying, roomState?.currentTime, roomState?.timeUpdatedAt]);

  // High-precision UI time from the native audio element
  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const t = audio.currentTime;
    setLocalTime(Number.isFinite(t) ? t : 0);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const d = audio.duration;
    setDuration(Number.isFinite(d) ? d : 0);
  }, []);

  // Periodic PROGRESS updates from the current clock owner
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !roomState) return;
    if (!roomState.isPlaying) return;
    if (roomState.clockClientId !== client.clientId) return;

    const timer = window.setInterval(() => {
      const t = audio.currentTime;
      if (!Number.isFinite(t)) return;
      client.sendCommand("PROGRESS", { time: t });
    }, 500);
    return () => window.clearInterval(timer);
  }, [roomState?.isPlaying, roomState?.clockClientId, client]);

  // Lyrics + colors enrichment (local-only)
  useEffect(() => {
    if (!currentSong) return;

    const id = currentSong.id;
    let cancelled = false;
    const currentExtra = extras[id];

    // colors from cover
    if (currentSong.coverUrl && !(extras[id]?.colors?.length)) {
      extractColors(currentSong.coverUrl)
        .then((colors) => {
          if (cancelled) return;
          if (colors.length > 0) {
            setExtras((prev) => ({
              ...prev,
              [id]: { ...(prev[id] || {}), colors },
            }));
          }
        })
        .catch(() => {});
    }

    // lyrics match (cloud) if missing
    const existingLyrics = currentExtra?.lyrics ?? currentSong.lyrics ?? [];
    const needsMatch =
      currentExtra?.needsLyricsMatch ??
      currentSong.needsLyricsMatch ??
      // In synced rooms, queue items won't include needsLyricsMatch; default to true when lyrics are empty.
      (existingLyrics.length === 0);
    if (existingLyrics.length > 0) {
      setMatchStatus("success");
      return () => {
        cancelled = true;
      };
    }
    if (!needsMatch) {
      setMatchStatus("failed");
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      setMatchStatus("matching");
      try {
        const result = currentSong.isNetease && currentSong.neteaseId
          ? await fetchLyricsById(currentSong.neteaseId)
          : await searchAndMatchLyrics(currentSong.title, currentSong.artist);
        if (cancelled) return;
        if (result) {
          const parsed = parseLyrics(result.lrc, result.tLrc, { yrcContent: result.yrc });
          setExtras((prev) => ({
            ...prev,
            [id]: { ...(prev[id] || {}), lyrics: parsed, needsLyricsMatch: false },
          }));
          setMatchStatus("success");
        } else {
          setExtras((prev) => ({
            ...prev,
            [id]: { ...(prev[id] || {}), needsLyricsMatch: false },
          }));
          setMatchStatus("failed");
        }
      } catch {
        if (cancelled) return;
        setMatchStatus("failed");
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [
    currentSong?.id,
    currentSong?.title,
    currentSong?.artist,
    currentSong?.isNetease,
    currentSong?.neteaseId,
    extras[currentSong?.id || ""]?.needsLyricsMatch,
    extras[currentSong?.id || ""]?.lyrics?.length,
  ]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    const t = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : undefined;
    client.sendCommand("TOGGLE_PLAY", { currentTime: t });
  }, [client]);

  const play = useCallback(() => {
    const audio = audioRef.current;
    const t = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : undefined;
    client.sendCommand("PLAY", { currentTime: t });
  }, [client]);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    const t = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : undefined;
    client.sendCommand("PAUSE", { currentTime: t });
  }, [client]);

  const handleSeek = useCallback(
    (time: number, playImmediately: boolean = false, defer: boolean = false) => {
      const audio = audioRef.current;

      if (defer) {
        // Update UI only during drag
        setLocalTime(time);
        return;
      }

      if (audio) {
        try {
          audio.currentTime = time;
        } catch {}
      }

      client.sendCommand("SEEK", { time });
      if (playImmediately) {
        client.sendCommand("PLAY", { currentTime: time });
      }
    },
    [client],
  );

  const playIndex = useCallback((index: number) => {
    client.sendCommand("PLAY_INDEX", { index });
  }, [client]);

  const playNext = useCallback(() => {
    client.sendCommand("NEXT", {});
  }, [client]);

  const playPrev = useCallback(() => {
    client.sendCommand("PREV", {});
  }, [client]);

  const toggleMode = useCallback(() => {
    const current = (roomState?.playMode ?? 0) as number;
    const next = current === 0 ? 1 : current === 1 ? 2 : 0;
    client.sendCommand("SET_PLAYMODE", { playMode: next });
  }, [client, roomState?.playMode]);

  const removeSongs = useCallback((ids: string[]) => {
    client.sendCommand("REMOVE_SONGS", { ids });
  }, [client]);

  const addSongs = useCallback(
    (songs: Song[], opts?: { autoplayIfEmpty?: boolean; playSongId?: string }) => {
      // Ensure lyric matching runs even though synced queue items don't carry needsLyricsMatch.
      setExtras((prev) => {
        const next = { ...prev };
        for (const s of songs) {
          const existing = next[s.id] || {};
          const hasLyrics =
            (existing.lyrics && existing.lyrics.length > 0) ||
            (Array.isArray((s as any).lyrics) && (s as any).lyrics.length > 0);
          if (!hasLyrics && existing.needsLyricsMatch === undefined) {
            next[s.id] = { ...existing, needsLyricsMatch: true };
          }
        }
        return next;
      });

      client.sendCommand("ADD_SONGS", {
        songs: songs.map(stripSongForSync),
        autoplayIfEmpty: !!opts?.autoplayIfEmpty,
        playSongId: opts?.playSongId,
      });
    },
    [client],
  );

  const addLocalFiles = useCallback(async (files: FileList) => {
    const fileList = Array.from(files);
    const audioFiles: File[] = [];
    const lyricsFiles: File[] = [];

    fileList.forEach((file) => {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext === "lrc" || ext === "txt") lyricsFiles.push(file);
      else audioFiles.push(file);
    });

    // Map lyrics filename -> content (local-only)
    const lyricsMap = new Map<string, string>();
    for (const lf of lyricsFiles) {
      const basename = lf.name.replace(/\.[^/.]+$/, "");
      lyricsMap.set(basename.toLowerCase(), await lf.text());
    }

    const newSongs: Song[] = [];
    const extrasUpdates: Record<string, SongExtras> = {};

    const wasEmpty = (roomState?.queue?.length ?? 0) === 0;

    for (let i = 0; i < audioFiles.length; i++) {
      const file = audioFiles[i];
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `local-${Date.now()}-${i}-${Math.random().toString(16).slice(2)}`;

      // Upload audio
      const uploadedAudio = await uploadFile(file);
      let title = file.name.replace(/\.[^/.]+$/, "");
      let artist = "Unknown Artist";
      let coverUrl: string | undefined;

      const nameParts = title.split("-");
      if (nameParts.length > 1) {
        artist = nameParts[0].trim();
        title = nameParts.slice(1).join("-").trim();
      }

      try {
        const metadata = await parseAudioMetadata(file);
        if (metadata.title) title = metadata.title;
        if (metadata.artist) artist = metadata.artist;

        // Upload cover if present (to make it cross-device)
        if (metadata.picture) {
          const coverFile = dataUrlToFile(metadata.picture, `${id}.cover`);
          if (coverFile) {
            const uploadedCover = await uploadFile(coverFile);
            coverUrl = uploadedCover.url;
          }
        }

        // Embedded lyrics (local-only)
        if (metadata.lyrics && metadata.lyrics.trim()) {
          try {
            extrasUpdates[id] = {
              ...(extrasUpdates[id] || {}),
              lyrics: parseLyrics(metadata.lyrics),
              needsLyricsMatch: false,
            };
          } catch {}
        }
      } catch {
        // ignore
      }

      // If no embedded lyrics, try a same-basename .lrc/.txt (local-only)
      if (!extrasUpdates[id]?.lyrics?.length) {
        const basename = file.name.replace(/\.[^/.]+$/, "").toLowerCase();
        const maybe = lyricsMap.get(basename);
        if (maybe) {
          try {
            extrasUpdates[id] = {
              ...(extrasUpdates[id] || {}),
              lyrics: parseLyrics(maybe),
              needsLyricsMatch: false,
            };
          } catch {}
        } else {
          extrasUpdates[id] = { ...(extrasUpdates[id] || {}), needsLyricsMatch: true };
        }
      }

      newSongs.push({
        id,
        title,
        artist,
        fileUrl: uploadedAudio.url,
        coverUrl,
      });
    }

    if (Object.keys(extrasUpdates).length) {
      setExtras((prev) => ({ ...prev, ...extrasUpdates }));
    }

    if (newSongs.length > 0) {
      addSongs(newSongs, { autoplayIfEmpty: wasEmpty });
    }

    return newSongs;
  }, [addSongs, roomState?.queue?.length]);

  const importFromUrl = useCallback(async (input: string): Promise<{ success: boolean; message?: string; songs: Song[] }> => {
    const trimmed = input.trim();
    const parsed = parseNeteaseLink(trimmed);
    if (!parsed) {
      return {
        success: false,
        message: "Invalid Netease URL. Use https://music.163.com/#/song?id=... or playlist",
        songs: [],
      };
    }

    const wasEmpty = (roomState?.queue?.length ?? 0) === 0;
    const newSongs: Song[] = [];
    try {
      if (parsed.type === "playlist") {
        const songs = await fetchNeteasePlaylist(parsed.id);
        songs.forEach((song) => {
          newSongs.push({
            ...song,
            fileUrl: getNeteaseAudioUrl(song.id),
            lyrics: [],
            colors: [],
            needsLyricsMatch: true,
          });
        });
      } else {
        const song = await fetchNeteaseSong(parsed.id);
        if (song) {
          newSongs.push({
            ...song,
            fileUrl: getNeteaseAudioUrl(song.id),
            lyrics: [],
            colors: [],
            needsLyricsMatch: true,
          });
        }
      }
    } catch (err) {
      return { success: false, message: "Failed to load songs from URL", songs: [] };
    }

    if (newSongs.length === 0) {
      return { success: false, message: "Failed to load songs from URL", songs: [] };
    }

    addSongs(newSongs, { autoplayIfEmpty: wasEmpty });
    return { success: true, songs: newSongs };
  }, [addSongs, roomState?.queue?.length]);

  const addSongAndPlay = useCallback((song: Song) => {
    const songId = song.id;
    addSongs([song], { autoplayIfEmpty: (roomState?.queue?.length ?? 0) === 0, playSongId: songId });
  }, [addSongs, roomState?.queue?.length]);

  const addToQueue = useCallback((song: Song) => {
    addSongs([song], { autoplayIfEmpty: (roomState?.queue?.length ?? 0) === 0 });
  }, [addSongs, roomState?.queue?.length]);

  const handleAudioEnded = useCallback(() => {
    // Server owns next/loop logic
    playNext();
  }, [playNext]);

  return {
    roomId,
    connectionStatus,

    audioRef,
    currentSong,
    currentSongId,
    currentIndex,
    queue: mergedQueue,
    originalQueue,

    playMode,
    playState: isPlaying ? PlayState.PLAYING : PlayState.PAUSED,
    matchStatus,
    accentColor,

    currentTime: localTime,
    duration,

    togglePlay,
    toggleMode,
    handleSeek,
    playNext,
    playPrev,
    playIndex,
    play,
    pause,
    removeSongs,
    addLocalFiles,
    importFromUrl,
    addSongAndPlay,
    addToQueue,
    handleTimeUpdate,
    handleLoadedMetadata,
    handleAudioEnded,
  };
}

