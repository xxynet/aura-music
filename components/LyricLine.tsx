import React, { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { LyricLine as LyricLineType } from "../types";
import { SpringSystem, SpringConfig } from "../services/springSystem";


// Matrix3d for Scale 1 (No scaling) and TranslateY -2px
// column-major: sx, 0, 0, 0,  0, sy, 0, 0,  0, 0, 1, 0,  tx, ty, tz, 1
const MATRIX_FLOAT =
  "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -2, 0, 1)";
const GLOW_STYLE = "0 0 15px rgba(255,255,255,0.8)";

export interface LyricLineHandle {
  update: (dt: number, currentY: number, activePoint: number, isMobile: boolean, visualState: boolean) => void;
  offsetTop: number;
  offsetHeight: number;
}

interface LyricLineProps {
  index: number;
  line: LyricLineType;
  isActive: boolean;
  isUserScrolling: boolean;
  distance: number;
  onLineClick: (time: number) => void;
  audioRef: React.RefObject<HTMLAudioElement>;
  isMobile: boolean;
  scaleSpringConfig?: SpringConfig;
}

const LyricLine = React.memo(
  forwardRef<LyricLineHandle, LyricLineProps>(
    ({
      index,
      line,
      isActive,
      distance,
      isUserScrolling,
      onLineClick,
      audioRef,
      isMobile,
      scaleSpringConfig,
    }, ref) => {
      const divRef = useRef<HTMLDivElement>(null);
      const wordsRef = useRef<(HTMLSpanElement | null)[]>([]);
      const rafRef = useRef<number>(0);
      const springSystem = useRef(new SpringSystem({ scale: 1 })).current;

      // Reset refs array to match current words length
      wordsRef.current = wordsRef.current.slice(0, line.words?.length || 0);

      useImperativeHandle(ref, () => ({
        get offsetTop() {
          return divRef.current?.offsetTop || 0;
        },
        get offsetHeight() {
          return divRef.current?.offsetHeight || 0;
        },
        update: (dt, currentY, activePoint, isMobile, visualState) => {
          if (!divRef.current) return;

          const lineTop = divRef.current.offsetTop;
          const lineHeight = divRef.current.offsetHeight;
          const lineCenter = lineTop + lineHeight / 2;
          const dist = Math.abs(lineCenter - activePoint);
          const range = 500;
          const normDist = Math.min(dist, range) / range;

          // --- Target Calculations ---
          // Scale: 1.1 at center, 0.95 at edges
          const targetScale = 1.1 - 0.15 * normDist;

          // Apply Targets to Spring System using passed configs or defaults
          if (scaleSpringConfig) {
            springSystem.setTarget("scale", targetScale, scaleSpringConfig);
          } else {
            springSystem.setTarget("scale", targetScale);
          }

          // Update Line Physics
          springSystem.update(dt);

          const currentScale = springSystem.getCurrent("scale");

          // Opacity & Blur
          const minOpacity = visualState ? 0.35 : 0.28;
          const baseOpacity = 1.0 - Math.pow(normDist, 0.5) * (1.0 - minOpacity);
          const fadeMultiplier = isActive ? 1 : visualState ? 0.55 : 0.25;
          const opacity = Math.min(1, baseOpacity * fadeMultiplier);

          const blur = isMobile
            ? 0
            : visualState
              ? 0
              : 4 * Math.pow(normDist, 1.5);

          divRef.current.style.transform = `matrix3d(${currentScale},0,0,0,0,${currentScale},0,0,0,0,1,0,0,${-currentY},0,1)`;
          divRef.current.style.opacity = opacity.toFixed(3);
          divRef.current.style.filter = blur > 0.5 ? `blur(${blur.toFixed(1)}px)` : "none";
        }
      }));

      useEffect(() => {
        const updateWordStyles = () => {
          if (!audioRef.current) return;
          const currentTime = audioRef.current.currentTime;

          if (line.words && line.words.length > 0) {
            line.words.forEach((word, i) => {
              const span = wordsRef.current[i];
              if (!span) return;

              // Base classes
              const baseClass = `word-base whitespace-pre`;

              if (!isActive) {
                span.className = baseClass;
                span.style.backgroundImage = "";
                span.style.webkitBackgroundClip = "";
                span.style.backgroundClip = "";
                span.style.webkitTextFillColor = "";
                span.style.color = "";
                span.style.transform = "";
                span.style.textShadow = "";
                return;
              }

              const duration = word.endTime - word.startTime;
              const elapsed = currentTime - word.startTime;

              if (currentTime < word.startTime) {
                // --- FUTURE WORD ---
                span.className = `${baseClass} word-future`;
                span.style.backgroundImage = "";
                span.style.webkitBackgroundClip = "";
                span.style.backgroundClip = "";
                span.style.webkitTextFillColor = "";
                span.style.color = "";
                // Reset transform explicitly for animation to work
                span.style.transform = "translate3d(0,0,0) scale(1)";
                span.style.textShadow = "";
              } else if (currentTime > word.endTime) {
                // --- PAST WORD ---
                span.className = `${baseClass} word-past`;
                span.style.backgroundImage = "";
                span.style.webkitBackgroundClip = "";
                span.style.backgroundClip = "";
                span.style.webkitTextFillColor = "";
                span.style.color = ""; // Handled by CSS class (white)

                // Past words stay floated (no scale)
                span.style.transform = "translate3d(0,-4px,0) scale(1)";
                span.style.textShadow = "";
              } else {
                // --- CURRENT WORD (Karaoke) ---
                span.className = `${baseClass}`;

                // 1. Gradient Fill (X-Moving Highlight)
                const p = Math.max(0, Math.min(1, elapsed / duration));
                const percentage = (p * 100).toFixed(1);

                span.style.backgroundImage = `linear-gradient(90deg, #FFFFFF ${percentage}%, rgba(255,255,255,0.5) ${percentage}%)`;
                span.style.webkitBackgroundClip = "text";
                span.style.backgroundClip = "text";
                span.style.webkitTextFillColor = "transparent";
                span.style.color = "transparent";

                // 2. Float Animation (Skew Lift)
                // "Left side up first, then right side" effect
                // We simulate this by combining a vertical lift with a skew or rotation.
                // As p goes 0 -> 1:
                // - Lift goes 0 -> -4px
                // - Skew/Rotation creates the "tilt"

                const lift = -4 * p; // Linear lift target
                // Skew Y: Starts 0, peaks in middle, ends 0? 
                // Or: Rotate slightly so left is higher?
                // Let's try a skewY that starts positive (right side lower) and reduces to 0.
                // Actually, if we translate Y up, and skew Y positive, the right side drops back down.

                const maxSkew = 1; // degrees
                const currentSkew = maxSkew * (1 - p); // 10deg -> 0deg

                // We want the left side to rise immediately, but the right side to "drag".
                // transform-origin is 'center bottom' or 'left bottom'.
                // If origin is 'left bottom':
                // skewY(positive) makes the right side go DOWN relative to left.
                // So if we lift the whole word up, and skew it down, the left stays up, right stays low.

                span.style.transformOrigin = "left baseline";
                span.style.transform = `translate3d(0,${lift}px,0) skewY(${currentSkew}deg) scale(1)`;

                // 3. Conditional Glow
                // Requirement: Duration > 1.5s (judgment), but show immediately (advance)
                const isLongNote = duration > 1;
                const isShortWord = word.text.trim().length < 7;
                const shouldGlow = isLongNote && isShortWord;

                span.style.textShadow = shouldGlow ? GLOW_STYLE : "";
              }
            });
          }
        };

        if (isActive) {
          const loop = () => {
            updateWordStyles();
            rafRef.current = requestAnimationFrame(loop);
          };
          rafRef.current = requestAnimationFrame(loop);
        } else {
          updateWordStyles();
        }

        return () => cancelAnimationFrame(rafRef.current);
      }, [isActive, line, audioRef, isMobile]);

      const textSizeClass = isMobile
        ? "text-3xl md:text-3xl lg:text-4xl"
        : "text-3xl md:text-4xl lg:text-5xl";

      return (
        <div
          ref={divRef}
          onClick={() => onLineClick(line.time)}
          className={`
                  py-4 rounded-2xl cursor-pointer mr-6 px-6
                  origin-left
                  transition-colors duration-200
                  hover:bg-white/10
                  ${isActive ? "line-active" : "line-inactive"}
              `}
          style={{
            willChange: "transform, opacity, filter",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
          }}
        >
          <style>{`
                  .word-base {
                      display: inline-block;
                      /* Removed 'color' from transition to prevent flickering during gradient switch */
                      transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
                                  text-shadow 0.5s ease;
                      will-change: transform, opacity;
                      transform-origin: left baseline;
                      /* Prevent text clipping for descenders/ascenders */
                      padding: 4px 0;
                      margin: -2px 0;
                      overflow: visible;
                  }
  
                  /* ACTIVE LINE Context */
                  .line-active .word-past {
                      color: #fff;
                      opacity: 1;
                  }
  
                  .line-active .word-future {
                      color: rgba(255,255,255,0.5);
                      opacity: 1;
                  }
  
                  /* INACTIVE LINE Context */
                  .line-inactive .word-base {
                      color: inherit;
                      opacity: 1;
                      transform: translate3d(0,0,0) scale(1) !important;
                      text-shadow: none !important;
                  }
              `}</style>

          <div
            className={`${textSizeClass} font-semibold leading-normal text-white tracking-wide`}
          >
            {line.words && line.words.length > 0 ? (
              line.words.map((word, i) => (
                <span
                  key={i}
                  ref={(el) => {
                    wordsRef.current[i] = el;
                  }}
                  className={`word-base whitespace-pre`}
                >
                  {word.text}
                </span>
              ))
            ) : (
              <span className="transition-all whitespace-pre-wrap break-words duration-[300ms] mr-2.5 tracking-wide">
                {line.text}
              </span>
            )}
          </div>
          {line.translation && (
            <div className="mt-2 text-lg md:text-xl font-medium text-white/60">
              {line.translation}
            </div>
          )}
        </div>
      );
    },
  )
);

export default LyricLine;
