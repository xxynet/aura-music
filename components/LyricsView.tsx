import React, { useRef, useEffect, useState } from "react";
import { LyricLine as LyricLineType } from "../types";
import { useLyricsPhysics } from "../hooks/useLyricsPhysics";
import { useCanvasRenderer } from "../hooks/useCanvasRenderer";
import { measureLyrics, drawLyricLine, LineLayout } from "./LyricLineCanvas";

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
  const [lineLayouts, setLineLayouts] = useState<LineLayout[]>([]);
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

  // Measure Lyrics (Effect)
  useEffect(() => {
    if (!lyrics.length || containerWidth <= 0) {
      // Ensure we don't set null, always empty array
      setLineLayouts((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    // Create a temporary canvas for measurement
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { layouts } = measureLyrics(ctx, lyrics, containerWidth, isMobile);
    setLineLayouts((prev) => {
      if (prev.length !== layouts.length) {
        return layouts;
      }

      const isSame =
        prev.every(
          (line, idx) =>
            line.y === layouts[idx].y &&
            line.height === layouts[idx].height &&
            line.textWidth === layouts[idx].textWidth &&
            line.fullText === layouts[idx].fullText &&
            line.translation === layouts[idx].translation,
        ) && prev.length === layouts.length;

      return isSame ? prev : layouts;
    });
  }, [lyrics, containerWidth, isMobile]);

  // Extract positions and heights for physics hook
  const linePositions = lineLayouts.map((l) => l.y);
  const lineHeights = lineLayouts.map((l) => l.height);

  // Physics Hook
  const { activeIndex, handlers, linesState, updatePhysics } = useLyricsPhysics(
    {
      lyrics,
      audioRef,
      currentTime,
      isMobile,
      containerHeight:
        typeof window !== "undefined" ? window.innerHeight * 0.6 : 800, // Approx height
      linePositions,
      lineHeights,
      isScrubbing: false,
    },
  );

  // Mouse Interaction State
  const mouseRef = useRef({ x: 0, y: 0 });

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
    // Update Physics (cap dt to prevent explosion on tab switch)
    const dt = Math.min(deltaTime, 64) / 1000;
    updatePhysics(dt);

    // Safeguard: Ensure lineLayouts is valid
    if (!lineLayouts || lineLayouts.length === 0) return;

    const paddingX = isMobile ? 24 : 56;
    const focalPointOffset = height * 0.25; // Initial top offset

    // Detect Hover (re-calculate every frame to be responsive to scrolling)
    let currentHover = -1;

    // Render visible lines
    lyrics.forEach((line, index) => {
      const layout = lineLayouts[index];
      if (!layout) return;

      const physics = linesState.current.get(index);
      if (!physics) return;

      // Calculate Y position
      // layout.y is the static position in the document
      // physics.posY.current is the global scroll offset (negative value)
      const globalScroll = physics.posY.current;
      const visualY = layout.y + globalScroll + focalPointOffset;

      // Culling
      if (visualY + layout.height < -100 || visualY > height + 100) {
        return;
      }

      // Hit Test for Hover
      if (
        mouseRef.current.x >= paddingX - 20 &&
        mouseRef.current.x <= width - paddingX + 20 &&
        mouseRef.current.y >= visualY &&
        mouseRef.current.y <= visualY + layout.height
      ) {
        currentHover = index;
      }

      const isActive = index === activeIndex;
      const scale = physics.scale.current;

      // Opacity & Blur Calculation
      // Based on distance from focal point
      const lineCenter = visualY + layout.height / 2;
      const focusY = height * 0.35; // Match focal point
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

      // Force full opacity if hovered
      if (index === currentHover) {
        opacity = Math.max(opacity, 0.8);
        blur = 0;
      }

      drawLyricLine(
        ctx,
        layout,
        paddingX,
        Math.round(visualY),
        scale,
        opacity,
        blur,
        isActive,
        currentTime,
        isMobile,
        index === currentHover,
      );
    });

    // Draw Mask (Gradient at top/bottom)
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

    for (let i = 0; i < lineLayouts.length; i++) {
      const layout = lineLayouts[i];
      const physics = linesState.current.get(i);
      if (!physics) continue;

      const visualY = layout.y + physics.posY.current + focalPointOffset;
      if (clickY >= visualY && clickY <= visualY + layout.height) {
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
