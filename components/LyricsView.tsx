import React, { useRef, useEffect, useState, useMemo } from "react";
import { LyricLine as LyricLineType } from "../types";
import { useLyricsPhysics } from "../hooks/useLyricsPhysics";
import { useCanvasRenderer } from "../hooks/useCanvasRenderer";
import { LyricLine } from "./lyrics/LyricLine";

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
  const [isMobile, setIsMobile] = useState(false);
  const [lyricLines, setLyricLines] = useState<LyricLine[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

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

  // Measure Container Width
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Initialize and Measure LyricLines
  useEffect(() => {
    if (!lyrics.length || containerWidth <= 0) {
      setLyricLines([]);
      return;
    }

    // Create LyricLine instances
    const lines = lyrics.map((line, index) => {
      const lyricLine = new LyricLine(line, index, isMobile);
      lyricLine.measure(containerWidth);
      return lyricLine;
    });

    setLyricLines(lines);
  }, [lyrics, containerWidth, isMobile]);

  // Calculate layout properties for physics
  const { linePositions, lineHeights } = useMemo(() => {
    const positions: number[] = [];
    const heights: number[] = [];
    let currentY = 0;
    const marginY = 12;

    lyricLines.forEach((line) => {
      const h = line.getHeight();
      positions.push(currentY);
      heights.push(h);
      currentY += h + marginY;
    });

    return { linePositions: positions, lineHeights: heights };
  }, [lyricLines]);

  // Physics Hook
  const { activeIndex, handlers, linesState, updatePhysics } = useLyricsPhysics(
    {
      lyrics,
      audioRef,
      currentTime,
      isMobile,
      containerHeight:
        typeof window !== "undefined" ? window.innerHeight * 0.6 : 800,
      linePositions,
      lineHeights,
      isScrubbing: false,
    },
  );

  // Mouse Interaction State
  const mouseRef = useRef({ x: 0, y: 0 });
  const visualTimeRef = useRef(currentTime);

  // Mouse Tracking
  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    handlers.onTouchMove(e);
  };

  // Render Function
  const render = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    deltaTime: number,
  ) => {
    // Update Physics
    const dt = Math.min(deltaTime, 64) / 1000;
    updatePhysics(dt);

    // Smooth lyric animation time
    let visualTime = visualTimeRef.current;
    const targetTime = currentTime;

    if (isPlaying) {
      visualTime += dt;
      const drift = targetTime - visualTime;
      visualTime += drift * 0.05;
    } else {
      // Ease quickly toward the real time when paused or scrubbing
      const easeFactor = Math.min(1, dt * 8);
      visualTime += (targetTime - visualTime) * easeFactor;
    }

    if (!Number.isFinite(visualTime) || Math.abs(targetTime - visualTime) > 2) {
      visualTime = targetTime;
    }

    visualTimeRef.current = visualTime;

    if (!lyricLines.length) return;

    const paddingX = isMobile ? 24 : 56;
    const focalPointOffset = height * 0.25;

    let currentHover = -1;

    // First pass: Determine hover and visibility
    // We can optimize this if needed, but for now iterating is fine.
    // Actually, we need to iterate to draw anyway.
    lyricLines.forEach((line, index) => {
      const physics = linesState.current.get(index);
      if (!physics) return;

      const globalScroll = physics.posY.current;
      const visualY = linePositions[index] + globalScroll + focalPointOffset;
      const lineHeight = lineHeights[index];

      // Culling
      if (visualY + lineHeight < -100 || visualY > height + 100) {
        return;
      }

      // Hit Test for Hover
      if (
        mouseRef.current.x >= paddingX - 20 &&
        mouseRef.current.x <= width - paddingX + 20 &&
        mouseRef.current.y >= visualY &&
        mouseRef.current.y <= visualY + lineHeight
      ) {
        currentHover = index;
      }

      const isActive = index === activeIndex;
      const scale = physics.scale.current;

      // Opacity & Blur
      const lineCenter = visualY + lineHeight / 2;
      const focusY = height * 0.35;
      const dist = Math.abs(lineCenter - focusY);

      let opacity = 1;
      let blur = 0;

      if (!isActive) {
        const normDist = Math.min(dist, 600) / 600;
        const minOpacity = isMobile ? 0.4 : 0.25;
        opacity = minOpacity + (1 - minOpacity) * (1 - Math.pow(normDist, 0.5));

        if (!isMobile) {
          blur = normDist * 3;
        }
      }

      if (index === currentHover) {
        opacity = Math.max(opacity, 0.8);
        blur = 0;
      }

      // Update the line's internal state (draws to its own canvas)
      // We only need to redraw if something changed (time, active state, hover)
      // For now, we draw every frame because of the karaoke animation.
      // Optimization: Only draw active line every frame? Or check if time is within line range?
      // The LyricLine.draw method handles word animations.
      line.draw(
        isActive ? visualTime : currentTime,
        isActive,
        index === currentHover,
      );

      // Draw the line's canvas onto the main canvas
      ctx.save();

      // Apply transformations
      const cy = visualY + lineHeight / 2;
      ctx.translate(0, cy); // Translate to vertical center of the line position
      ctx.scale(scale, scale);
      ctx.translate(0, -lineHeight / 2); // Translate back to top-left relative to center

      ctx.globalAlpha = opacity;
      if (blur > 0.5) {
        ctx.filter = `blur(${blur}px)`;
      } else {
        ctx.filter = "none";
      }

      // The line canvas is already sized to containerWidth, so we draw it at (0, 0) relative to the translation
      // But wait, our translation logic above assumes we are at the correct Y.
      // We translated to (0, cy) then back up.
      // So we draw at (0, 0).
      // Use logical dimensions for HiDPI support
      ctx.drawImage(
        line.getCanvas(),
        0,
        0,
        line.getLogicalWidth(),
        line.getLogicalHeight(),
      );

      ctx.restore();
    });

    // Draw Mask
    ctx.globalCompositeOperation = "destination-in";
    const maskGradient = ctx.createLinearGradient(0, 0, 0, height);
    maskGradient.addColorStop(0, "rgba(0,0,0,0)");
    maskGradient.addColorStop(0.15, "rgba(0,0,0,1)");
    maskGradient.addColorStop(0.85, "rgba(0,0,0,1)");
    maskGradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = maskGradient;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = "source-over";
  };

  const canvasRef = useCanvasRenderer({ onRender: render });

  const handleClick = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const height = rect.height;
    const focalPointOffset = height * 0.25;

    for (let i = 0; i < lyricLines.length; i++) {
      const physics = linesState.current.get(i);
      if (!physics) continue;

      const visualY =
        linePositions[i] + physics.posY.current + focalPointOffset;
      const h = lineHeights[i];

      if (clickY >= visualY && clickY <= visualY + h) {
        onSeekRequest(lyrics[i].time, true);
        break;
      }
    }
  };

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
      className="relative h-[95vh] lg:h-[65vh] w-full overflow-hidden cursor-grab active:cursor-grabbing touch-none select-none"
      onWheel={handlers.onWheel}
      onTouchStart={handlers.onTouchStart}
      onTouchMove={handlers.onTouchMove}
      onTouchEnd={handlers.onTouchEnd}
      onMouseDown={handlers.onTouchStart}
      onMouseMove={handleMouseMove}
      onMouseUp={handlers.onTouchEnd}
      onMouseLeave={(e) => {
        mouseRef.current = { x: -1000, y: -1000 };
        handlers.onTouchEnd();
      }}
      onClick={handleClick}
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
};

export default LyricsView;
