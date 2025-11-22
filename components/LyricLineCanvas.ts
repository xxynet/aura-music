import { LyricLine } from "../types";

// Constants matching DOM implementation
const GLOW_STYLE = "rgba(255,255,255,0.8)";

export interface WordLayout {
    text: string;
    x: number;
    y: number; // Relative Y offset within the line block
    width: number;
    startTime: number;
    endTime: number;
    isVerbatim: boolean; // To distinguish between timed words and wrapped segments
}

export interface LineLayout {
    y: number; // Absolute Y position in the document
    height: number;
    words: WordLayout[];
    fullText: string;
    translation?: string;
    translationLines?: string[]; // New field for wrapped translation
    textWidth: number; // Max width of the text block
}

const detectLanguage = (text: string) => {
    const cjkRegex = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;
    return cjkRegex.test(text) ? "zh" : "en";
};

// Font configuration
const getFonts = (isMobile: boolean) => {
    // Sizes matched to previous Tailwind classes (text-3xl/4xl/5xl)
    const baseSize = isMobile ? 32 : 40;
    const transSize = isMobile ? 18 : 22;
    return {
        main: `800 ${baseSize}px "PingFang SC", "Inter", sans-serif`,
        trans: `500 ${transSize}px "PingFang SC", "Inter", sans-serif`,
        mainHeight: baseSize, // Increased line height for better wrapping
        transHeight: transSize * 1.3,
    };
};

interface MeasureLineOptions {
    ctx: CanvasRenderingContext2D;
    line: LyricLine;
    segmenter: Intl.Segmenter | null;
    lang: string;
    maxWidth: number;
    baseSize: number;
    mainHeight: number;
    paddingY: number;
    mainFont: string;
}

const measureLine = ({
    ctx,
    line,
    segmenter,
    lang,
    maxWidth,
    baseSize,
    mainHeight,
    paddingY,
    mainFont,
}: MeasureLineOptions) => {
    ctx.font = mainFont;

    const words: WordLayout[] = [];
    let currentLineX = 0;
    let currentLineY = paddingY;
    let maxLineWidth = 0;

    const addWord = (text: string, start: number, end: number, isVerbatim: boolean) => {
        const metrics = ctx.measureText(text);
        let width = metrics.width;
        if (width === 0 && text.trim().length > 0) {
            width = text.length * (baseSize * 0.5);
        }

        if (currentLineX + width > maxWidth && currentLineX > 0) {
            currentLineX = 0;
            currentLineY += mainHeight;
        }

        words.push({
            text,
            x: currentLineX,
            y: currentLineY,
            width,
            startTime: start,
            endTime: end,
            isVerbatim,
        });

        currentLineX += width;
        maxLineWidth = Math.max(maxLineWidth, currentLineX);
    };

    if (line.words && line.words.length > 0) {
        line.words.forEach((w) => {
            addWord(w.text, w.startTime, w.endTime, true);
        });
    } else if (segmenter) {
        const segments = segmenter.segment(line.text);
        for (const seg of segments) {
            addWord(seg.segment, line.time, 999999, false);
        }
    } else if (lang === "zh") {
        line.text.split("").forEach((c) => {
            addWord(c, line.time, 999999, false);
        });
    } else {
        const wordsArr = line.text.split(" ");
        wordsArr.forEach((word, index) => {
            addWord(word, line.time, 999999, false);
            if (index < wordsArr.length - 1) {
                addWord(" ", line.time, 999999, false);
            }
        });
    }

    return {
        words,
        textWidth: maxLineWidth,
        height: currentLineY + mainHeight,
    };
};

interface MeasureTranslationOptions {
    ctx: CanvasRenderingContext2D;
    translation: string;
    maxWidth: number;
    transHeight: number;
    transFont: string;
}

const measureTranslationLines = ({
    ctx,
    translation,
    maxWidth,
    transHeight,
    transFont,
}: MeasureTranslationOptions) => {
    ctx.font = transFont;
    const isEn = detectLanguage(translation) === "en";
    const atoms = isEn ? translation.split(" ") : translation.split("");

    const lines: string[] = [];
    let currentTransLine = "";
    let currentTransWidth = 0;

    atoms.forEach((atom, index) => {
        const atomText = isEn && index < atoms.length - 1 ? atom + " " : atom;
        const width = ctx.measureText(atomText).width;

        if (currentTransWidth + width > maxWidth && currentTransWidth > 0) {
            lines.push(currentTransLine);
            currentTransLine = atomText;
            currentTransWidth = width;
        } else {
            currentTransLine += atomText;
            currentTransWidth += width;
        }
    });

    if (currentTransLine) {
        lines.push(currentTransLine);
    }

    return {
        lines,
        height: lines.length ? lines.length * transHeight + 4 : 0,
    };
};

export const measureLyrics = (
    ctx: CanvasRenderingContext2D,
    lyrics: LyricLine[],
    containerWidth: number,
    isMobile: boolean,
): { layouts: LineLayout[]; totalHeight: number } => {
    const { main, trans, mainHeight, transHeight } = getFonts(isMobile);
    const baseSize = isMobile ? 32 : 40;
    const paddingY = 12; // Vertical padding of the line box
    const marginY = 12; // Gap between lines (Reduced from 12)
    const paddingX = isMobile ? 24 : 56;
    const maxWidth = containerWidth - paddingX * 2;

    const layouts: LineLayout[] = [];
    let currentY = 0;

    // Detect dominant language from the first few lines
    const sampleText = lyrics.slice(0, 5).map(l => l.text).join(" ");
    const lang = detectLanguage(sampleText);

    // Important: Set baseline before measuring
    ctx.textBaseline = "top"; // Ensure consistent baseline for measurement

    // Segmenter for wrapping plain text
    // @ts-ignore: Intl.Segmenter is available in modern browsers
    const segmenter = typeof Intl !== "undefined" && Intl.Segmenter
        ? new Intl.Segmenter(lang, { granularity: "word" })
        : null;

    lyrics.forEach((line) => {
        const { words, textWidth, height: lineHeight } = measureLine({
            ctx,
            line,
            segmenter,
            lang,
            maxWidth,
            baseSize,
            mainHeight,
            paddingY,
            mainFont: main,
        });
        let blockHeight = lineHeight;

        let translationLines: string[] | undefined = undefined;
        if (line.translation) {
            const translationWrapWidth = textWidth > 0 ? textWidth : maxWidth;
            const translationResult = measureTranslationLines({
                ctx,
                translation: line.translation,
                maxWidth: translationWrapWidth,
                transHeight,
                transFont: trans,
            });
            translationLines = translationResult.lines;
            blockHeight += translationResult.height;
        }

        blockHeight += paddingY;

        layouts.push({
            y: currentY,
            height: blockHeight,
            words,
            fullText: line.text,
            translation: line.translation,
            translationLines,
            textWidth,
        });

        currentY += blockHeight + marginY;
    });

    // Add significant bottom padding to ensure the last line can scroll up to the focal point
    // Focal point is roughly 35% of screen height. 
    // We add enough space so the last line can be at the top 35%.
    return { layouts, totalHeight: currentY + containerWidth * 0.8 };
};

export const drawLyricLine = (
    ctx: CanvasRenderingContext2D,
    layout: LineLayout,
    x: number,
    y: number,
    scale: number,
    opacity: number,
    blur: number,
    isActive: boolean,
    currentTime: number,
    isMobile: boolean,
    isHovered: boolean,
) => {
    const { main, trans, mainHeight } = getFonts(isMobile);

    ctx.save();

    // Apply transformations
    // Pivot point for scale should be center of the block
    const cy = y + layout.height / 2;
    ctx.translate(x, cy);
    ctx.scale(scale, scale);
    ctx.translate(0, -layout.height / 2); // Move back to top-left of the block (relative to center)

    // Opacity & Filter
    ctx.globalAlpha = opacity;
    // Fix: Clamp small blur values to 0 to prevent sub-pixel rendering artifacts (ghosting)
    if (blur > 0.5) {
        ctx.filter = `blur(${blur}px)`;
    } else {
        ctx.filter = "none";
    }

    // Hover Background
    if (isHovered) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
        // Draw rounded rectangle covering the whole block
        const bgWidth = Math.max(layout.textWidth + 32, 200);
        roundRect(ctx, -16, 0, bgWidth, layout.height, 16);
        ctx.fill();
    }

    // Draw Main Text
    ctx.font = main;
    ctx.textBaseline = "top";

    const hasTimedWords = layout.words.some((w) => w.isVerbatim);

    if (!isActive) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
        layout.words.forEach((w) => {
            ctx.fillText(w.text, w.x, w.y);
        });
    } else if (!hasTimedWords) {
        // Active without per-word timing: keep the whole line bright but without karaoke animation.
        ctx.fillStyle = "#ffffff";
        layout.words.forEach((w) => {
            ctx.fillText(w.text, w.x, w.y);
        });
    } else {
        layout.words.forEach((w) => {
            drawLyricWord(ctx, w, currentTime);
        });
    }

    // Draw Translation
    if (layout.translationLines && layout.translationLines.length > 0) {
        ctx.font = trans;
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)";

        const lastWordY = layout.words.length > 0 ? layout.words[layout.words.length - 1].y : 0;
        let transY = lastWordY + mainHeight * 1.2;

        layout.translationLines.forEach(lineText => {
            ctx.fillText(lineText, 0, transY);
            transY += getFonts(isMobile).transHeight;
        });
    }

    ctx.restore();
};

/**
 * Draws a single word during the active state, choosing between a glow-heavy
 * treatment and the simpler lift/gradient animation.
 */
function drawLyricWord(
    ctx: CanvasRenderingContext2D,
    word: WordLayout,
    currentTime: number,
) {
    ctx.save();
    ctx.translate(word.x, word.y);

    const duration = word.endTime - word.startTime;
    const elapsed = currentTime - word.startTime;

    if (currentTime < word.startTime) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
        ctx.fillText(word.text, 0, 0);
    } else if (currentTime > word.endTime) {
        ctx.fillStyle = "#ffffff";
        const liftMax = -3;
        ctx.translate(0, liftMax);
        ctx.fillText(word.text, 0, 0);
    } else {
        let progress = 0;
        if (duration > 0) {
            progress = Math.max(0, Math.min(1, elapsed / duration));
        }

        const useGlow = duration > 1 && word.text.length <= 7;
        if (useGlow) {
            drawGlowAnimation(ctx, word, currentTime, elapsed, duration);
        } else {
            drawStandardAnimation(ctx, word, progress, duration);
        }
    }

    ctx.restore();
}

function drawGlowAnimation(
    ctx: CanvasRenderingContext2D,
    word: WordLayout,
    currentTime: number,
    elapsed: number,
    duration: number,
) {
    const chars = word.text.split("");
    if (chars.length === 0) {
        ctx.fillText(word.text, 0, 0);
        return;
    }

    // Adaptive animation duration based on word length
    const charCount = chars.length;
    // Shorter words get proportionally more time per character
    const baseTimePerChar = charCount <= 3 ? 0.25 : (charCount <= 5 ? 0.25 : 0.18);
    const MAX_GLOW_DURATION = Math.max(1.0, charCount * baseTimePerChar);
    const effectiveDuration = Math.min(duration, MAX_GLOW_DURATION);
    const isAnimating = elapsed < effectiveDuration;

    // Adaptive spread: tighter for short words, wider for long words
    // Short words (1-3 chars): spread = 0.8-1.2
    // Medium words (4-6 chars): spread = 1.5-2.5
    // Long words (7+ chars): spread = 3.0+
    const spread = charCount <= 3 ? 0.8 + charCount * 0.2 :
        charCount <= 6 ? 1.0 + charCount * 0.25 :
            2.5 + (charCount - 6) * 0.3;

    // Calculate animation progress with smooth easing
    let effectiveP = 0;
    if (effectiveDuration > 0) {
        const rawP = Math.max(0, Math.min(1, elapsed / effectiveDuration));
        // Use ease-out-cubic for smoother start
        effectiveP = 1 - Math.pow(1 - rawP, 3);
    }
    if (!isAnimating) effectiveP = 1;

    // Breathing effect - more subtle and adaptive
    const breathTime = currentTime * 2.5;
    const breathPhase = Math.sin(breathTime);

    // Adaptive blur: stronger for shorter words
    const baseBlur = charCount <= 3 ? 28 : (charCount <= 5 ? 22 : 18);
    const breathBlur = isAnimating ? baseBlur + 6 * breathPhase : baseBlur * 0.7;

    // Adaptive scale: more pronounced for short words
    const breathScaleAmount = charCount <= 3 ? 0.035 : (charCount <= 5 ? 0.025 : 0.018);
    const breathScale = isAnimating ? (1.0 + breathScaleAmount * breathPhase) : 1.0;

    // Set shadow for glow effect
    ctx.shadowColor = isAnimating ? "rgba(255, 255, 255, 0.7)" : "rgba(255, 255, 255, 0.4)";
    ctx.shadowBlur = breathBlur;

    // The wave center position across the word
    const activeIndex = effectiveP * (chars.length + spread * 2) - spread;

    let charX = 0;

    chars.forEach((char, charIndex) => {
        const charWidth = ctx.measureText(char).width;
        const dist = Math.abs(charIndex - activeIndex);

        // Gaussian intensity curve - controls how the glow spreads
        const gaussian = Math.exp(-(dist * dist) / (2 * spread * spread));

        // Character scale animation
        // Adaptive max scale: larger for short words
        const maxScale = charCount <= 3 ? 1.12 : (charCount <= 5 ? 1.08 : 1.05);
        const scaleDelta = maxScale - 1.0;
        const currentScale = isAnimating ? (1.0 + scaleDelta * gaussian) : 1.0;
        const charScale = currentScale * breathScale;

        // Character activation timing - each char "lights up" as the wave passes
        // For short words, use a steeper activation curve
        const charNormalizedPos = charIndex / Math.max(1, chars.length - 1);
        const activationProgress = effectiveP;

        // Smooth step function for character activation
        const activationWindow = charCount <= 3 ? 0.4 : 0.3; // Wider window for short words
        const charActivationStart = charNormalizedPos - activationWindow;
        const charActivationEnd = charNormalizedPos + activationWindow;

        let charActivation = 0;
        if (activationProgress < charActivationStart) {
            charActivation = 0;
        } else if (activationProgress > charActivationEnd) {
            charActivation = 1;
        } else {
            // Smooth step interpolation
            const t = (activationProgress - charActivationStart) / (charActivationEnd - charActivationStart);
            charActivation = t * t * (3 - 2 * t); // Smoothstep
        }

        ctx.save();
        ctx.translate(charX, 0);
        ctx.translate(charWidth / 2, 0);
        ctx.scale(charScale, charScale);
        ctx.translate(-charWidth / 2, 0);

        if (!isAnimating) {
            // Post-animation: full white
            ctx.fillStyle = "#ffffff";
        } else {
            // During animation: blend based on activation and gaussian intensity
            const intensity = Math.max(charActivation, gaussian * 0.5);
            const brightness = Math.max(0.5, Math.min(1.0, 0.5 + intensity * 0.5));

            // Add extra intensity at the peak of the wave
            const peakBoost = gaussian > 0.7 ? (gaussian - 0.7) * 0.5 : 0;
            const finalBrightness = Math.min(1.0, brightness + peakBoost);

            ctx.fillStyle = charActivation > 0.8 ? "#ffffff" : `rgba(255, 255, 255, ${finalBrightness})`;
        }

        ctx.fillText(char, 0, 0);
        ctx.restore();

        charX += charWidth;
    });

    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
}

// Simple ease-in-out easing function
// t: 0 to 1
function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function drawStandardAnimation(
    ctx: CanvasRenderingContext2D,
    word: WordLayout,
    progress: number,
    duration: number,
) {
    // Use ease-in-out for smooth transition
    const easeVal = easeInOutCubic(progress);

    // Skew effect: starts slanted (right-bottom), gradually straightens
    // Positive skew tilts right-bottom, negative tilts left
    const maxSkew = 0.005; // Initial skew angle in radians (~8.5 degrees)
    const skewX = maxSkew * (1 - easeVal); // Goes from maxSkew to 0

    // Rise effect: coordinated with skew
    const liftMax = -3;
    const lift = liftMax * easeVal;

    // Apply transformations
    ctx.translate(0, lift);
    ctx.transform(1, 0, -skewX, 1, 0, 0); // Skew on X axis

    const gradientWidth = Math.max(word.width, 1);
    const fillGradient = ctx.createLinearGradient(0, 0, gradientWidth, 0);

    const startStop = Math.max(0, Math.min(1, progress - 0.2));
    const endStop = Math.max(0, Math.min(1, progress + 0.2));

    if (isFinite(startStop) && isFinite(endStop)) {
        fillGradient.addColorStop(startStop, "#ffffff");
        fillGradient.addColorStop(endStop, "rgba(255, 255, 255, 0.5)");
    } else {
        fillGradient.addColorStop(0, "#ffffff");
        fillGradient.addColorStop(1, "rgba(255, 255, 255, 0.5)");
    }

    ctx.fillStyle = fillGradient;
    ctx.fillText(word.text, 0, 0);
}

function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
