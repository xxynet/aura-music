import React, { useCallback, useEffect, useState } from "react";
import { useToast } from "./hooks/useToast";
import { PlayState, Song } from "./types";
import FluidBackground from "./components/FluidBackground";
import Controls from "./components/Controls";
import LyricsView from "./components/LyricsView";
import PlaylistPanel from "./components/PlaylistPanel";
import KeyboardShortcuts from "./components/KeyboardShortcuts";
import TopBar from "./components/TopBar";
import { LinkIcon } from "./components/Icons";
import SearchModal from "./components/SearchModal";
import RoomLobby from "./components/RoomLobby";
import Landing from "./components/Landing";
import { useRoom } from "./hooks/useRoom";
import { createRoom, deleteRoom, ROOM_ID_RE } from "./services/roomSync";
import PwaUpdatePrompt from "./components/PwaUpdatePrompt";
import { useI18n } from "./hooks/useI18n";
import { keyboardRegistry } from "./services/keyboardRegistry";
import MediaSessionController from "./components/MediaSessionController";
import { getThemeColor } from "./services/utils";

const App: React.FC = () => {
  const { toast } = useToast();
  const { dict } = useI18n();
  const room = useRoom();

  const {
    audioRef,
    currentSong,
    playState,
    currentTime,
    duration,
    playMode,
    matchStatus,
    accentColor,
    togglePlay,
    toggleMode,
    handleSeek,
    playNext,
    playPrev,
    handleTimeUpdate,
    handleLoadedMetadata,
    playIndex,
    addSongAndPlay,
    handleAudioEnded,
    play,
    pause,
    queue,
    removeSongs,
    addLocalFiles,
    importFromUrl,
    addToQueue,
    roomCreator,
    roomViewers,
    roomId,
    joined,
    inRoom,
    missing,
    deleted,
    isHost,
    enterRoom,
    leaveRoom,
    connectionStatus,
  } = room;

  const [showPlaylist, setShowPlaylist] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showRoomDialog, setShowRoomDialog] = useState(false);
  const [roomInput, setRoomInput] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showVolumePopup, setShowVolumePopup] = useState(false);
  const [showSettingsPopup, setShowSettingsPopup] = useState(false);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [preservesPitch, setPreservesPitch] = useState(true);

  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [activePanel, setActivePanel] = useState<"controls" | "lyrics">(
    "controls",
  );
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const theme = currentSong?.themeColor || getThemeColor(currentSong?.colors);
  // Once the room is gone (deleted or absent) the lobby notice takes over,
  // even for members who already entered.
  const roomGone = inRoom && (missing || deleted);
  const openPlaylist = useCallback(() => {
    setShowPlaylist(true);
  }, []);
  const closePlaylist = useCallback(() => {
    setShowPlaylist(false);
  }, []);
  const togglePlaylist = useCallback(() => {
    setShowPlaylist((prev) => !prev);
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume, audioRef]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.preservesPitch = preservesPitch;
      audioRef.current.playbackRate = speed;
    }
  }, [audioRef, preservesPitch, speed, currentSong?.id, playState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = theme;
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(max-width: 1024px)");
    const updateLayout = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsMobileLayout(event.matches);
    };
    updateLayout(query);
    query.addEventListener("change", updateLayout);
    return () => query.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    if (!isMobileLayout) {
      setActivePanel("controls");
      setTouchStartX(null);
      setDragOffsetX(0);
    }
  }, [isMobileLayout]);

  // Global Keyboard Registry Initialization
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyboardRegistry.handle(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Global Search Shortcut (Registered directly via useEffect for simplicity, or could use useKeyboardScope with high priority)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleFileChange = async (files: FileList) => {
    try {
      await addLocalFiles(files);
    } catch (err: any) {
      toast.error(err?.message || "Failed to import local files");
    }
  };

  const handleImportUrl = useCallback(async (input: string): Promise<boolean> => {
    const trimmed = input.trim();
    if (!trimmed) return false;
    const result = await importFromUrl(trimmed);
    if (!result.success) {
      toast.error(result.message ?? dict.app.importFail);
      return false;
    }
    if (result.songs.length > 0) {
      toast.success(dict.app.importOk(result.songs.length));
      return true;
    }
    return false;
  }, [
    dict.app.importFail,
    dict.app.importOk,
    importFromUrl,
    queue.length,
    toast,
  ]);

  const handleImportAndPlay = useCallback((song: Song) => {
    // Check if song already exists in queue (by neteaseId for cloud songs, or by id)
    const existingIndex = queue.findIndex((s) => {
      if (song.isNetease && s.isNetease) {
        return s.neteaseId === song.neteaseId;
      }
      return s.id === song.id;
    });

    if (existingIndex !== -1) {
      // Song already in queue, just play it
      playIndex(existingIndex);
    } else {
      // Add and play atomically - no race conditions!
      addSongAndPlay(song);
    }
  }, [addSongAndPlay, playIndex, queue]);

  const handleAddToQueue = (song: Song) => {
    addToQueue(song);
  };

  const goToRoom = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("room", id);
    window.location.href = url.toString();
  };

  const handleJoinRoom = () => {
    const id = roomInput.trim();
    if (!id) return;
    if (!ROOM_ID_RE.test(id)) {
      toast.error(dict.room.invalidId);
      return;
    }
    goToRoom(id);
  };

  const handleCreateRoom = async () => {
    const id = roomInput.trim() || Math.random().toString(36).slice(2, 8);
    if (!ROOM_ID_RE.test(id)) {
      toast.error(dict.room.invalidId);
      return;
    }
    try {
      await createRoom(id);
      goToRoom(id);
    } catch (err: any) {
      if (err?.status === 409) {
        toast.error(dict.room.createExists);
      } else if (err?.status === 401) {
        toast.error(dict.room.createLogin);
      } else {
        toast.error(dict.room.createFail);
      }
    }
  };

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

  // Two-step confirm so a single slip cannot wipe the room.
  useEffect(() => {
    if (!confirmDelete) return;
    const timer = window.setTimeout(() => setConfirmDelete(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmDelete]);

  useEffect(() => {
    if (!showRoomDialog) setConfirmDelete(false);
  }, [showRoomDialog]);

  const handleDeleteRoom = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setConfirmDelete(false);
    try {
      await deleteRoom(roomId);
      setShowRoomDialog(false);
      // The websocket close switches the view to the deleted-room notice.
    } catch {
      toast.error(dict.room.deleteFail);
    }
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileLayout) return;
    setTouchStartX(event.touches[0]?.clientX ?? null);
    setDragOffsetX(0);
    setIsDragging(true);
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileLayout || touchStartX === null) return;
    const currentX = event.touches[0]?.clientX;
    if (currentX === undefined) return;
    const deltaX = currentX - touchStartX;
    const containerWidth = event.currentTarget.getBoundingClientRect().width;
    const limitedDelta = Math.max(
      Math.min(deltaX, containerWidth),
      -containerWidth,
    );
    setDragOffsetX(limitedDelta);
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileLayout || touchStartX === null) return;
    const endX = event.changedTouches[0]?.clientX;
    if (endX === undefined) {
      setTouchStartX(null);
      setDragOffsetX(0);
      setIsDragging(false);
      return;
    }
    const deltaX = endX - touchStartX;
    const threshold = 60;
    if (deltaX > threshold) {
      setActivePanel("controls");
    } else if (deltaX < -threshold) {
      setActivePanel("lyrics");
    }
    setTouchStartX(null);
    setDragOffsetX(0);
    setIsDragging(false);
  };

  const handleTouchCancel = () => {
    if (isMobileLayout) {
      setTouchStartX(null);
      setDragOffsetX(0);
      setIsDragging(false);
    }
  };

  const toggleIndicator = () => {
    setActivePanel((prev) => (prev === "controls" ? "lyrics" : "controls"));
    setDragOffsetX(0);
    setIsDragging(false);
  };

  const controlsSection = (
    <div className="flex flex-col items-center justify-center w-full h-full z-30 relative p-4">
      <div className="relative flex flex-col items-center gap-8 w-full max-w-[720px]">
        <Controls
          isPlaying={playState === PlayState.PLAYING}
          onPlayPause={togglePlay}
          currentTime={currentTime}
          duration={duration}
          trackId={currentSong?.id || "no-song"}
          onSeek={handleSeek}
          title={currentSong?.title || dict.app.welcome}
          artist={currentSong?.artist || dict.app.selectSong}
          audioRef={audioRef}
          onNext={playNext}
          onPrev={playPrev}
          playMode={playMode}
          onToggleMode={toggleMode}
          onTogglePlaylist={openPlaylist}
          accentColor={accentColor}
          volume={volume}
          onVolumeChange={setVolume}
          speed={speed}
          preservesPitch={preservesPitch}
          onSpeedChange={setSpeed}
          onTogglePreservesPitch={() => setPreservesPitch((p) => !p)}
          coverUrl={currentSong?.coverUrl}
          isBuffering={false}
          showVolumePopup={showVolumePopup}
          setShowVolumePopup={setShowVolumePopup}
          showSettingsPopup={showSettingsPopup}
          setShowSettingsPopup={setShowSettingsPopup}
          playlistPanel={
            <PlaylistPanel
              isOpen={showPlaylist}
              onClose={closePlaylist}
              queue={queue}
              currentSongId={currentSong?.id}
              onPlay={playIndex}
              onImport={handleImportUrl}
              onRemove={removeSongs}
              accentColor={accentColor}
            />
          }
        />
      </div>
    </div>
  );

  const lyricsVersion = currentSong?.lyrics ? currentSong.lyrics.length : 0;
  const lyricsKey = currentSong
    ? `${currentSong.id}-${lyricsVersion}`
    : "no-song";

  const lyricsSection = (
    <div className="w-full h-full relative z-20 flex flex-col justify-center px-4 lg:pl-12">
      <LyricsView
        key={lyricsKey}
        lyrics={currentSong?.lyrics || []}
        audioRef={audioRef}
        isPlaying={playState === PlayState.PLAYING}
        currentTime={currentTime}
        onSeekRequest={handleSeek}
        matchStatus={matchStatus}
      />
    </div>
  );

  const shift = activePanel === "lyrics" ? "-50%" : "0px";
  const transform = `translateX(calc(${shift} + ${dragOffsetX}px))`;

  return (
    <div
      className="relative w-full h-screen flex flex-col overflow-hidden"
      style={{ height: "100dvh" }}
    >
      <FluidBackground
        key={isMobileLayout ? "mobile" : "desktop"}
        colors={currentSong?.colors || []}
        coverUrl={currentSong?.coverUrl}
        isPlaying={playState === PlayState.PLAYING}
        isMobileLayout={isMobileLayout}
      />

      <audio
        ref={audioRef}
        src={currentSong?.fileUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleAudioEnded}
        crossOrigin="anonymous"
      />

      {joined && !roomGone && (
        <KeyboardShortcuts
          isPlaying={playState === PlayState.PLAYING}
          onPlayPause={togglePlay}
          onNext={playNext}
          onPrev={playPrev}
          onSeek={handleSeek}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          onVolumeChange={setVolume}
          onToggleMode={toggleMode}
          onTogglePlaylist={togglePlaylist}
          speed={speed}
          onSpeedChange={setSpeed}
          onToggleVolumeDialog={() => setShowVolumePopup((prev) => !prev)}
          onToggleSpeedDialog={() => setShowSettingsPopup((prev) => !prev)}
        />
      )}

      {joined && !roomGone && (
        <MediaSessionController
          currentSong={currentSong ?? null}
          playState={playState}
          currentTime={currentTime}
          duration={duration}
          playbackRate={speed}
          onPlay={play}
          onPause={pause}
          onNext={playNext}
          onPrev={playPrev}
          onSeek={handleSeek}
        />
      )}

      <PwaUpdatePrompt />

      {/* Top Bar */}
      <TopBar
        onFilesSelected={handleFileChange}
        onSearchClick={() => setShowSearch(true)}
        onRoomClick={() => setShowRoomDialog(true)}
      />

      {/* Search Modal - Always rendered to preserve state, visibility handled internally */}
      <SearchModal
        isOpen={showSearch}
        onClose={() => setShowSearch(false)}
        queue={queue}
        onPlayQueueIndex={playIndex}
        onImportAndPlay={handleImportAndPlay}
        onAddToQueue={handleAddToQueue}
        currentSong={currentSong}
        isPlaying={playState === PlayState.PLAYING}
        accentColor={accentColor}
      />

      {/* Room Dialog */}
      {showRoomDialog && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-6" onClick={() => setShowRoomDialog(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-sm bg-black/30 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {inRoom ? (
              <>
                <h3 className="text-lg font-semibold mb-2">{dict.room.title}</h3>
                <div className="rounded-2xl bg-white/5 border border-white/10 px-4 py-3 mb-4">
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
                {roomCreator && (
                  <div className="flex items-center justify-between text-sm mb-3">
                    <span className="text-white/50">{dict.room.creator}</span>
                    <span className="text-white/90">{roomCreator.displayName}</span>
                  </div>
                )}
                {roomViewers.length > 0 && (
                  <div className="mb-4">
                    <div className="text-sm text-white/50 mb-2">
                      {dict.room.viewers(roomViewers.length)}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {roomViewers.map((viewer, idx) => (
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
                {!joined && (
                  <button
                    type="button"
                    onClick={() => {
                      enterRoom();
                      setShowRoomDialog(false);
                    }}
                    className="w-full py-3 rounded-2xl text-sm font-semibold bg-white text-black hover:bg-white/90 active:scale-[0.99] transition-all mb-3"
                  >
                    {dict.room.enter}
                  </button>
                )}
                <button
                  type="button"
                  onClick={leaveRoom}
                  className={`w-full py-3 rounded-2xl text-sm font-semibold transition-all ${
                    joined
                      ? "bg-white text-black hover:bg-white/90"
                      : "bg-white/10 text-white/80 hover:bg-white/20"
                  }`}
                >
                  {dict.room.leave}
                </button>
                {isHost && (
                  <button
                    type="button"
                    onClick={handleDeleteRoom}
                    className={`mt-3 w-full py-3 rounded-2xl text-sm font-semibold transition-all ${
                      confirmDelete
                        ? "bg-red-500 text-white hover:bg-red-500/90"
                        : "bg-red-500/15 text-red-400 hover:bg-red-500/25"
                    }`}
                  >
                    {confirmDelete ? dict.room.deleteConfirm : dict.room.delete}
                  </button>
                )}
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold mb-2">{dict.room.createTitle}</h3>
                <p className="text-sm text-white/60 mb-4">{dict.room.createDesc}</p>
                <input
                  type="text"
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value)}
                  placeholder="e.g. my-room-123"
                  className="w-full bg-white/10 border border-white/15 rounded-xl px-3 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/40 mb-4"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleJoinRoom();
                    }
                  }}
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRoomDialog(false)}
                    className="px-3 py-2 rounded-xl text-sm text-white/70 hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateRoom}
                    className="px-4 py-2 rounded-xl text-sm font-semibold bg-white/15 text-white hover:bg-white/25"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={handleJoinRoom}
                    className="px-4 py-2 rounded-xl text-sm font-semibold bg-white text-black hover:bg-white/90"
                  >
                    Join
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Main Content Split */}
      {!inRoom || !roomId ? (
        <Landing
          onJoin={goToRoom}
          onCreate={() => setShowRoomDialog(true)}
        />
      ) : !joined || roomGone ? (
        <RoomLobby
          roomId={roomId}
          status={connectionStatus}
          creator={roomCreator}
          viewers={roomViewers}
          song={currentSong}
          queue={queue}
          playing={playState === PlayState.PLAYING}
          missing={missing}
          deleted={deleted}
          onEnter={enterRoom}
          onLeave={leaveRoom}
        />
      ) : isMobileLayout ? (
        <div className="flex-1 relative w-full h-full">
          <div
            className="w-full h-full overflow-hidden"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchCancel}
          >
            <div
              className={`flex h-full w-[200%] ${isDragging ? "transition-none" : "transition-transform duration-300"}`}
              style={{
                transform,
              }}
            >
              <div className="flex-none h-full w-1/2">
                {controlsSection}
              </div>
              <div className="flex-none h-full w-1/2">
                {lyricsSection}
              </div>
            </div>
          </div>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
            <button
              type="button"
              onClick={toggleIndicator}
              className="relative flex h-4 w-28 items-center justify-center rounded-full bg-white/10 backdrop-blur-2xl border border-white/15 transition-transform duration-200 active:scale-105"
              style={{
                transform: `translateX(${isDragging ? dragOffsetX * 0.04 : 0}px)`,
              }}
            >
              <span
                className={`absolute inset-0 rounded-full bg-white/25 backdrop-blur-[30px] transition-opacity duration-200 ${
                  activePanel === "controls" ? "opacity-90" : "opacity-60"
                }`}
              />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 grid lg:grid-cols-2 w-full h-full">
          {controlsSection}
          {lyricsSection}
        </div>
      )}
    </div>
  );
};

export default App;
