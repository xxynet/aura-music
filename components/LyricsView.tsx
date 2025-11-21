import React, { useRef, useEffect, useState, useLayoutEffect } from "react";
import { LyricLine as LyricLineType } from "../types";
import LyricLine, { LyricLineHandle } from "./LyricLine";
import { SpringSystem, POS_Y_SPRING, SCALE_SPRING } from "../services/springSystem";

// -------------------------------------------------------------------------
// Main Lyrics View (No Virtualization for smoothness)
// -------------------------------------------------------------------------

interface LyricsViewProps {
  lyrics: LyricLineType[];
  audioRef: React.RefObject<HTMLAudioElement>;
  isPlaying: boolean;
  currentTime: number;
  onSeekRequest: (time: number, immediate?: boolean) => void;
  matchStatus: "idle" | "matching" | "success" | "failed";
}

const LyricsView: React.FC<LyricsViewProps> = ({
  lyrics,
  audioRef,
  isPlaying,
  currentTime,
  onSeekRequest,
  matchStatus,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Map<number, LyricLineHandle>>(new Map());

  // -------------------------------------------------------------------------
  // Physics State
  // -------------------------------------------------------------------------
  const springSystem = useRef(new SpringSystem({ y: 0 }));
  const animationRef = useRef(0);
  const lastTimeRef = useRef(0);

  const scrollState = useRef({
    isDragging: false,
    lastInteractionTime: 0,
    touchStartY: 0,
    touchLastY: 0,
    touchStartX: 0,
    touchLastX: 0,
    touchVelocity: 0,
    visualState: false,
  });

  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isMobile, setIsMobile] = useState(false);
  const hasTranslation = lyrics.some((line) => line.translation);

  const RESUME_DELAY_MS = 3000;

  // Detect mobile layout
  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(max-width: 1024px)");
    const updateLayout = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(event.matches);
    };
    updateLayout(query);
    query.addEventListener("change", updateLayout);
    return () => query.removeEventListener("change", updateLayout);
  }, []);

  // -------------------------------------------------------------------------
  // Active Index Logic
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!lyrics.length) return;
    let idx = -1;

    // Simple linear search suitable for song lengths
    for (let i = 0; i < lyrics.length; i++) {
      if (currentTime >= lyrics[i].time) {
        const nextTime = lyrics[i + 1]?.time ?? Infinity;
        if (currentTime < nextTime) {
          idx = i;
          break;
        }
      }
    }

    if (idx !== -1 && idx !== activeIndex) {
      setActiveIndex(idx);
    }
  }, [currentTime, lyrics]);

  // -------------------------------------------------------------------------
  // Animation & Physics Loop
  // -------------------------------------------------------------------------

  useLayoutEffect(() => {
    const loop = (now: number) => {
      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = now;

      const sState = scrollState.current;
      const system = springSystem.current;

      // User Interaction Check
      const timeSinceInteraction = now - sState.lastInteractionTime;
      const isUserInteracting =
        sState.isDragging || timeSinceInteraction < RESUME_DELAY_MS;

      if (isUserInteracting !== sState.visualState) {
        sState.visualState = isUserInteracting;
        setIsUserScrolling(isUserInteracting);
      }

      // --- Physics Step ---
      if (isUserInteracting) {
        // Momentum (Friction)
        if (!sState.isDragging) {
          if (Math.abs(sState.touchVelocity) > 10) {
            const newY = system.getCurrent("y") + sState.touchVelocity * dt;
            system.setValue("y", newY);
            sState.touchVelocity *= 0.92; // Friction
          }
        }
      } else {
        // Auto Scroll Logic
        let targetY = system.getCurrent("y");

        if (activeIndex !== -1) {
          // Get exact position from DOM
          const activeEl = lineRefs.current.get(activeIndex);
          const containerH =
            containerRef.current?.clientHeight || window.innerHeight * 0.6;

          if (activeEl) {
            // Target Position: We want the active element to be at 30% of container height
            const desiredPos = containerH * 0.3;
            targetY = activeEl.offsetTop - desiredPos;
          }
        }

        // Smooth Spring to Target
        system.setTarget("y", targetY, POS_Y_SPRING);
      }

      // Update Physics
      system.update(dt);
      const currentY = system.getCurrent("y");

      // --- Render Updates ---

      if (containerRef.current) {
        const viewportHeight = containerRef.current.clientHeight;
        const activePoint = currentY + viewportHeight * 0.3;

        lineRefs.current.forEach((lineHandle) => {
          if (!lineHandle) return;
          lineHandle.update(dt, currentY, activePoint, isMobile, sState.visualState);
        });
      }

      animationRef.current = requestAnimationFrame(loop);
    };

    lastTimeRef.current = performance.now();
    animationRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationRef.current);
  }, [lyrics, activeIndex, isMobile]);

  // -------------------------------------------------------------------------
  // Interaction Handlers
  // -------------------------------------------------------------------------

  const handleTouchStart = (e: React.TouchEvent) => {
    scrollState.current.isDragging = true;
    scrollState.current.lastInteractionTime = performance.now();
    const touchY = e.touches[0].clientY;
    const touchX = e.touches[0].clientX;
    scrollState.current.touchStartY = touchY;
    scrollState.current.touchLastY = touchY;
    scrollState.current.touchStartX = touchX;
    scrollState.current.touchLastX = touchX;
    scrollState.current.touchVelocity = 0;

    // Reset spring to current position to take control
    const cur = springSystem.current.getCurrent("y");
    springSystem.current.setValue("y", cur);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const currentY = e.touches[0].clientY;
    const currentX = e.touches[0].clientX;
    const dy = scrollState.current.touchLastY - currentY;
    const absDx = Math.abs(currentX - scrollState.current.touchLastX);
    const absDy = Math.abs(dy);

    if (absDy > absDx) {
      e.stopPropagation();
    }

    scrollState.current.touchLastY = currentY;
    scrollState.current.touchLastX = currentX;

    const newY = springSystem.current.getCurrent("y") + dy;
    springSystem.current.setValue("y", newY);

    scrollState.current.touchVelocity = dy * 60; // Simple velocity calc
    scrollState.current.lastInteractionTime = performance.now();
  };

  const handleTouchEnd = () => {
    scrollState.current.isDragging = false;
    scrollState.current.lastInteractionTime = performance.now();
  };

  const handleWheel = (e: React.WheelEvent) => {
    scrollState.current.lastInteractionTime = performance.now();
    const dy = e.deltaY;
    const newY = springSystem.current.getCurrent("y") + dy;
    springSystem.current.setValue("y", newY);

    if (!scrollState.current.visualState) setIsUserScrolling(true);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (!lyrics.length) {
    return (
      <div className="h-[85vh] lg:h-[60vh] flex flex-col items-center justify-center text-white/40 select-none">
        {matchStatus === "matching" ? (
          <div className="animate-pulse">Syncing Lyrics...</div>
        ) : (
          <>
            <div className="text-4xl mb-4 opacity-50">♪</div>
            <div>Play music to view lyrics</div>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={`relative h-[95vh] ${hasTranslation ? "lg:h-[75vh]" : "lg:h-[65vh]"
        } w-full overflow-hidden cursor-grab active:cursor-grabbing touch-none select-none`}
      style={{
        maskImage: hasTranslation
          ? "linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%)"
          : "linear-gradient(to bottom, transparent 0%, black 40%, black 50%, transparent 100%)",
        WebkitMaskImage: hasTranslation
          ? "linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%)"
          : "linear-gradient(to bottom, transparent 0%, black 40%, black 50%, transparent 100%)",
      }}
    >
      <div
        ref={contentRef}
        className="absolute top-0 left-0 w-full px-4 md:pl-12 md:pr-12 will-change-transform"
        style={{ paddingTop: "30vh", paddingBottom: "40vh" }}
      >
        {lyrics.map((line, i) => {
          return (
            <LyricLine
              key={i}
              ref={(el) => {
                if (el) lineRefs.current.set(i, el);
                else lineRefs.current.delete(i);
              }}
              index={i}
              line={line}
              isActive={i === activeIndex}
              isUserScrolling={isUserScrolling}
              distance={Math.abs(i - activeIndex)}
              onLineClick={(t) => onSeekRequest(t, true)}
              audioRef={audioRef}
              isMobile={isMobile}
              scaleSpringConfig={SCALE_SPRING}
            />
          );
        })}
      </div>
    </div>
  );
};

export default LyricsView;
