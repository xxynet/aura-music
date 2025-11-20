import React, { useState, useRef, useEffect } from "react";
import { formatTime } from "../services/utils";
import Visualizer from "./Visualizer";
import { PlayMode } from "../types";

interface ControlsProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  title: string;
  artist: string;
  audioRef: React.RefObject<HTMLAudioElement>;
  onNext: () => void;
  onPrev: () => void;
  playMode: PlayMode;
  onToggleMode: () => void;
  onTogglePlaylist: () => void;
  accentColor: string;
}

const Controls: React.FC<ControlsProps> = ({
  isPlaying,
  onPlayPause,
  currentTime,
  duration,
  onSeek,
  title,
  artist,
  audioRef,
  onNext,
  onPrev,
  playMode,
  onToggleMode,
  onTogglePlaylist,
  accentColor,
}) => {
  const [showVolume, setShowVolume] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isLiked, setIsLiked] = useState(false);
  const volumeContainerRef = useRef<HTMLDivElement>(null);

  // Sync volume with audio element
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume, audioRef]);

  // Close volume popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        volumeContainerRef.current &&
        !volumeContainerRef.current.contains(event.target as Node)
      ) {
        setShowVolume(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getModeIcon = () => {
    // Standard white colors, simplified hover
    const iconClass =
      "w-5 h-5 text-white/60 hover:text-white transition-colors";

    switch (playMode) {
      case PlayMode.LOOP_ONE:
        return (
          <div className="relative">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={iconClass}
            >
              <path d="M17 2l4 4-4 4" />
              <path d="M3 11v-1a4 4 0 014-4h14" />
              <path d="M7 22l-4-4 4-4" />
              <path d="M21 13v1a4 4 0 01-4 4H3" />
            </svg>
            <span className="absolute -top-1 -right-1 text-[8px] font-bold bg-white text-black rounded-[2px] px-0.5 leading-none">
              1
            </span>
          </div>
        );
      case PlayMode.SHUFFLE:
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={iconClass}
          >
            <path d="M16 3h5v5" />
            <path d="M4 20L21 3" />
            <path d="M21 16v5h-5" />
            <path d="M15 15l6 6" />
            <path d="M4 4l5 5" />
          </svg>
        );
      default: // LOOP_ALL
        return (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={iconClass}
          >
            <path d="M17 2l4 4-4 4" />
            <path d="M3 11v-1a4 4 0 014-4h14" />
            <path d="M7 22l-4-4 4-4" />
            <path d="M21 13v1a4 4 0 01-4 4H3" />
          </svg>
        );
    }
  };

  return (
    <div className="w-full flex flex-col items-center justify-center gap-2 text-white select-none">
      {/* Song Info */}
      <div className="text-center mb-1 px-4">
        <h2 className="text-2xl font-bold tracking-tight drop-shadow-md line-clamp-1">
          {title}
        </h2>
        <p className="text-white/60 text-lg font-medium line-clamp-1">
          {artist}
        </p>
      </div>

      {/* Spectrum Visualizer */}
      <div className="w-full flex justify-center h-8 mb-2">
        <Visualizer audioRef={audioRef} isPlaying={isPlaying} />
      </div>

      {/* Progress Bar */}
      <div className="w-full max-w-xl flex items-center gap-3 text-xs font-medium text-white/50 group/bar relative">
        <span className="w-10 text-right font-mono tracking-widest">
          {formatTime(currentTime)}
        </span>

        <div className="relative flex-1 h-8 flex items-center cursor-pointer group">
          {/* Background Track */}
          <div className="absolute inset-x-0 h-[3px] bg-white/20 rounded-full group-hover:h-[6px] transition-all duration-200 ease-out"></div>

          {/* Active Progress */}
          <div
            className="absolute left-0 h-[3px] rounded-full group-hover:h-[6px] transition-all duration-200 ease-out"
            style={{
              width: `${(currentTime / (duration || 1)) * 100}%`,
              backgroundColor: "rgba(255,255,255,0.9)",
            }}
          ></div>

          {/* Input Range */}
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={currentTime}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
          />
        </div>

        <span className="w-10 font-mono tracking-widest">
          {formatTime(duration)}
        </span>
      </div>

      {/* Controls Row - Flattened for Equal Spacing */}
      {/* Layout: [Mode] [Vol] [Prev] [Play] [Next] [Like] [List] */}
      <div className="w-full max-w-[380px] mt-6 px-2">
        <div className="flex items-center justify-between w-full">
          {/* 1. Play Mode */}
          <button
            onClick={onToggleMode}
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
            title="Playback Mode"
          >
            {getModeIcon()}
          </button>

          {/* 2. Volume */}
          <div className="relative" ref={volumeContainerRef}>
            <button
              onClick={() => setShowVolume(!showVolume)}
              className={`p-2 rounded-full hover:bg-white/10 transition-colors ${
                showVolume ? "text-white" : "text-white/60 hover:text-white"
              }`}
              title="Volume"
            >
              {volume === 0 ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-5 h-5"
                >
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : volume < 0.5 ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-5 h-5"
                >
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-5 h-5"
                >
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              )}
            </button>

            {/* Volume Popup (iOS 18 Style) */}
            {showVolume && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-8 w-[52px] h-[150px] rounded-[26px] p-1.5 bg-black/20 backdrop-blur-[80px] saturate-150 shadow-[0_20px_50px_rgba(0,0,0,0.3)] animate-in fade-in slide-in-from-bottom-4 duration-200 z-50 flex flex-col cursor-auto">
                <div className="relative w-full flex-1 rounded-[20px] bg-white/20 overflow-hidden">
                  {/* Fill */}
                  <div
                    className="absolute bottom-0 w-full bg-white transition-[height] duration-100 ease-out"
                    style={{ height: `${volume * 100}%` }}
                  />

                  {/* Input Overlay */}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer touch-none"
                    style={
                      {
                        WebkitAppearance: "slider-vertical",
                        appearance: "slider-vertical",
                      } as any
                    }
                  />

                  {/* Icon Overlay (Mix Blend Mode) */}
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none text-white mix-blend-difference">
                    {volume === 0 ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="w-4 h-4"
                      >
                        <path
                          d="M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : volume < 0.5 ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="w-4 h-4"
                      >
                        <path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07" />
                      </svg>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="w-4 h-4"
                      >
                        <path d="M11 5L6 9H2v6h4l5 4V5zM19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                      </svg>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 3. Previous */}
          <button
            onClick={onPrev}
            className="text-white hover:text-white/70 transition-colors active:scale-90 duration-200"
            aria-label="Previous"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-9 h-9">
              <path d="M19,6c0-0.88-0.96-1.42-1.72-0.98L8.7,10.78C8.08,11.14,7.7,11.8,7.7,12.5s0.38,1.36,1,1.72l8.58,5.76 c0.76,0.44,1.72-0.1,1.72-0.98V6z M6,6C5.45,6,5,6.45,5,7v10c0,0.55,0.45,1,1,1s1-0.45,1-1V7C7,6.45,6.55,6,6,6z" />
            </svg>
          </button>

          {/* 4. Play/Pause (Center) */}
          <button
            onClick={onPlayPause}
            className="w-14 h-14 flex items-center justify-center rounded-full bg-white text-black hover:scale-105 active:scale-95 transition-transform duration-200 shadow-lg shadow-white/10"
          >
            <div className="relative w-6 h-6">
              {/* Pause Icon */}
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className={`absolute inset-0 w-full h-full transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${isPlaying ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-50 -rotate-90"}`}
              >
                <path d="M8 5C7.4 5 7 5.4 7 6V18C7 18.6 7.4 19 8 19H10C10.6 19 11 18.6 11 18V6C11 5.4 10.6 5 10 5H8Z" />
                <path d="M14 5C13.4 5 13 5.4 13 6V18C13 18.6 13.4 19 14 19H16C16.6 19 17 18.6 17 18V6C17 5.4 16.6 5 16 5H14Z" />
              </svg>

              {/* Play Icon - Rounded Triangle - Visually Centered */}
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className={`absolute inset-0 w-full h-full transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${!isPlaying ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-50 rotate-90"}`}
              >
                {/* Translate X by 1px to visually center the mass of the triangle */}
                <path
                  transform="translate(1, 0)"
                  d="M7 6.8C7 5.2 8.8 4.3 10.1 5.1L18.5 10.6C19.7 11.4 19.7 13.1 18.5 13.9L10.1 19.4C8.8 20.2 7 19.3 7 17.7V6.8Z"
                />
              </svg>
            </div>
          </button>

          {/* 5. Next */}
          <button
            onClick={onNext}
            className="text-white hover:text-white/70 transition-colors active:scale-90 duration-200"
            aria-label="Next"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-9 h-9">
              <path d="M5,18c0,0.88,0.96,1.42,1.72,0.98l8.58-5.76C15.92,12.86,16.3,12.2,16.3,11.5s-0.38-1.36-1-1.72L6.72,4.02 C5.96,3.58,5,4.12,5,5V18z M18,18c0.55,0,1-0.45,1-1V7c0-0.55-0.45-1-1-1s-1,0.45-1,1v10C17,17.55,17.45,18,18,18z" />
            </svg>
          </button>

          {/* 6. Like */}
          <button
            onClick={() => setIsLiked(!isLiked)}
            className={`p-2 rounded-full hover:bg-white/10 transition-colors ${
              isLiked ? "text-rose-500" : "text-white/60 hover:text-white"
            }`}
            title="Like"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill={isLiked ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>

          {/* 7. Playlist/Queue */}
          <button
            onClick={onTogglePlaylist}
            className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/60 hover:text-white"
            title="Queue"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5"
            >
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Controls;
