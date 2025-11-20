import React, { useRef, useEffect } from "react";
import { LyricLine as LyricLineType } from "../types";

const containsNonAscii = (text: string) => /[^\x00-\x7f]/.test(text);
const isPunctuation = (text: string) => /^[\p{P}\p{S}]+$/u.test(text);
const spacingClassForWord = (text: string, isMobile = false) => {
  if (isPunctuation(text)) return "mr-0.5";
  if (containsNonAscii(text)) return isMobile ? "mr-1" : "mr-1.5";
  return isMobile ? "mr-2" : "mr-2.5";
};

// Matrix3d for Scale 1 (No scaling) and TranslateY -2px
// column-major: sx, 0, 0, 0,  0, sy, 0, 0,  0, 0, 1, 0,  tx, ty, tz, 1
const MATRIX_FLOAT =
  "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -2, 0, 1)";
const GLOW_STYLE = "0 0 15px rgba(255,255,255,0.8)";

interface LyricLineProps {
  index: number;
  line: LyricLineType;
  isActive: boolean;
  isUserScrolling: boolean;
  distance: number;
  onLineClick: (time: number) => void;
  audioRef: React.RefObject<HTMLAudioElement>;
  setLineRef: (el: HTMLDivElement | null) => void;
  isMobile: boolean;
}

const LyricLine = React.memo(
  ({
    index,
    line,
    isActive,
    distance,
    isUserScrolling,
    onLineClick,
    audioRef,
    setLineRef,
    isMobile,
  }: LyricLineProps) => {
    const wordsRef = useRef<(HTMLSpanElement | null)[]>([]);
    const rafRef = useRef<number>(0);

    // Reset refs array to match current words length
    wordsRef.current = wordsRef.current.slice(0, line.words?.length || 0);

    useEffect(() => {
      const updateWordStyles = () => {
        if (!audioRef.current) return;
        const currentTime = audioRef.current.currentTime;

        if (line.words && line.words.length > 0) {
          line.words.forEach((word, i) => {
            const span = wordsRef.current[i];
            if (!span) return;

            // Base classes
            const spacing = spacingClassForWord(word.text, isMobile);
            const baseClass = `word-base ${spacing} whitespace-pre`;

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
              span.style.transform = MATRIX_FLOAT;
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

              // 2. Float Animation (Using Matrix3d, no scale)
              span.style.transform = MATRIX_FLOAT;

              // 3. Conditional Glow
              // Requirement: Duration > 1.5s (judgment), but show immediately (advance)
              const isLongNote = duration > 1.5;
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
        ref={setLineRef}
        onClick={() => onLineClick(line.time)}
        className={`
                py-4 px-6 md:px-8 rounded-2xl cursor-pointer w-fit max-w-5xl
                origin-left
                transition-colors duration-300
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
                    transform-origin: center bottom;
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
          className={`${textSizeClass} font-bold leading-tight tracking-tight text-white`}
        >
          {line.words && line.words.length > 0 ? (
            line.words.map((word, i) => (
              <span
                key={i}
                ref={(el) => {
                  wordsRef.current[i] = el;
                }}
                className={`word-base ${spacingClassForWord(word.text, isMobile)} whitespace-pre`}
              >
                {word.text}
              </span>
            ))
          ) : (
            <span className="transition-all whitespace-pre-wrap break-words duration-[500ms] mr-2.5 tracking-wide">
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
);

export default LyricLine;
