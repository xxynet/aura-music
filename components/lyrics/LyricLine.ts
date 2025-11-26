import { LyricLine as LyricLineType } from "../../types";

export interface WordLayout {
  text: string;
  x: number;
  y: number; // Relative Y offset within the line block
  width: number;
  startTime: number;
  endTime: number;
  isVerbatim: boolean; // To distinguish between timed words and wrapped segments
  charWidths?: number[];
  charOffsets?: number[];
  renderProgress?: number;
  renderSnapshot?: WordRenderSnapshot;
}

type WordRenderPhase = "before" | "active-standard" | "active-glow" | "after";

interface WordRenderSnapshot {
  phase: WordRenderPhase;
  rawProgress: number;
  lastGlowSample?: number;
}

export interface LineLayout {
  y: number; // Absolute Y position in the document (managed externally now, but kept for compatibility if needed)
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

export class LyricLine {
  private canvas: OffscreenCanvas | HTMLCanvasElement;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  private layout: LineLayout | null = null;
  private lyricLine: LyricLineType;
  private index: number;
  private isMobile: boolean;
  private lastDrawTime: number = -1;
  private _height: number = 0;
  private lastIsActive: boolean = false;
  private lastIsHovered: boolean = false;
  private isDirty: boolean = true;
  private pixelRatio: number;
  private logicalWidth: number = 0;
  private logicalHeight: number = 0;

  constructor(line: LyricLineType, index: number, isMobile: boolean) {
    this.lyricLine = line;
    this.index = index;
    this.isMobile = isMobile;
    this.pixelRatio =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    this.canvas = document.createElement("canvas");

    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get canvas context");
    this.ctx = ctx as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D;
  }

  private shouldUseGlow(word: WordLayout, duration: number) {
    return duration > 1 && word.text.length <= 7;
  }

  private computeWordSnapshot(
    word: WordLayout,
    currentTime: number,
  ): WordRenderSnapshot {
    const duration = word.endTime - word.startTime;
    if (currentTime <= word.startTime) {
      return { phase: "before", rawProgress: 0 };
    }

    if (duration <= 0 || currentTime >= word.endTime) {
      return { phase: "after", rawProgress: 1 };
    }

    const elapsed = currentTime - word.startTime;
    const rawProgress = Math.max(0, Math.min(1, elapsed / duration));
    const phase = this.shouldUseGlow(word, duration)
      ? "active-glow"
      : "active-standard";

    return { phase, rawProgress };
  }

  private shouldRedrawWord(
    word: WordLayout,
    snapshot: WordRenderSnapshot,
    currentTime: number,
  ) {
    if (!word.renderSnapshot) return true;
    if (word.renderSnapshot.phase !== snapshot.phase) return true;

    if (snapshot.phase === "active-standard") {
      return (
        Math.abs(snapshot.rawProgress - word.renderSnapshot.rawProgress) > 0.003
      );
    }

    if (snapshot.phase === "active-glow") {
      const progressDelta = Math.abs(
        snapshot.rawProgress - word.renderSnapshot.rawProgress,
      );
      const timeDelta =
        !word.renderSnapshot.lastGlowSample ||
        currentTime - word.renderSnapshot.lastGlowSample > 0.05;

      return progressDelta > 0.002 || timeDelta;
    }

    return false;
  }

  private drawFullLine({
    currentTime,
    isActive,
    isHovered,
    hasTimedWords,
    mainFont,
    transFont,
    mainHeight,
    transHeight,
    paddingX,
    snapshots,
  }: {
    currentTime: number;
    isActive: boolean;
    isHovered: boolean;
    hasTimedWords: boolean;
    mainFont: string;
    transFont: string;
    mainHeight: number;
    transHeight: number;
    paddingX: number;
    snapshots?: Map<WordLayout, WordRenderSnapshot>;
  }) {
    if (!this.layout) return;

    // Use logical dimensions for clearRect since context is already scaled
    this.ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);
    this.ctx.save();

    if (isHovered) {
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      const bgWidth = Math.max(this.layout.textWidth + 32, 200);
      this.roundRect(paddingX - 16, 0, bgWidth, this.layout.height, 16);
      this.ctx.fill();
    }

    this.ctx.font = mainFont;
    this.ctx.textBaseline = "top";
    this.ctx.translate(paddingX, 0);

    if (!isActive) {
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      this.layout.words.forEach((w) => {
        this.ctx.fillText(w.text, w.x, w.y);
        w.renderSnapshot = undefined;
        w.renderProgress = undefined;
      });
    } else if (!hasTimedWords) {
      this.ctx.fillStyle = "#ffffff";
      this.layout.words.forEach((w) => {
        this.ctx.fillText(w.text, w.x, w.y);
        w.renderSnapshot = undefined;
        w.renderProgress = undefined;
      });
    } else {
      this.layout.words.forEach((w) => {
        const snapshot =
          snapshots?.get(w) ?? this.computeWordSnapshot(w, currentTime);
        this.drawLyricWord(w, currentTime);
        w.renderSnapshot = {
          ...snapshot,
          lastGlowSample:
            snapshot.phase === "active-glow" ? currentTime : undefined,
        };
      });
    }

    if (
      this.layout.translationLines &&
      this.layout.translationLines.length > 0
    ) {
      this.ctx.font = transFont;
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.6)";

      const lastWordY =
        this.layout.words.length > 0
          ? this.layout.words[this.layout.words.length - 1].y
          : 0;
      let transY = lastWordY + mainHeight * 1.2;

      this.layout.translationLines.forEach((lineText) => {
        this.ctx.fillText(lineText, 0, transY);
        transY += transHeight;
      });
    }

    this.ctx.restore();
  }

  public measure(containerWidth: number) {
    const { main, trans, mainHeight, transHeight } = getFonts(this.isMobile);
    const baseSize = this.isMobile ? 32 : 40;
    const paddingY = 12;
    const paddingX = this.isMobile ? 24 : 56;
    const maxWidth = containerWidth - paddingX * 2;

    // Reset context font for measurement
    this.ctx.font = main;
    this.ctx.textBaseline = "top";

    const lang = detectLanguage(this.lyricLine.text);

    // @ts-ignore: Intl.Segmenter
    const segmenter =
      typeof Intl !== "undefined" && Intl.Segmenter
        ? new Intl.Segmenter(lang, { granularity: "word" })
        : null;

    // Measure main text
    const {
      words,
      textWidth,
      height: lineHeight,
    } = this.measureLineText({
      line: this.lyricLine,
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

    if (this.lyricLine.translation) {
      const translationWrapWidth = textWidth > 0 ? textWidth : maxWidth;
      const translationResult = this.measureTranslationLines({
        translation: this.lyricLine.translation,
        maxWidth: translationWrapWidth,
        transHeight,
        transFont: trans,
      });
      translationLines = translationResult.lines;
      blockHeight += translationResult.height;
    }

    blockHeight += paddingY;
    this._height = blockHeight;

    this.layout = {
      y: 0, // Relative to this canvas
      height: blockHeight,
      words,
      fullText: this.lyricLine.text,
      translation: this.lyricLine.translation,
      translationLines,
      textWidth,
    };

    // Store logical dimensions
    this.logicalWidth = containerWidth;
    this.logicalHeight = blockHeight;

    // Set canvas physical resolution for HiDPI displays
    this.canvas.width = containerWidth * this.pixelRatio;
    this.canvas.height = blockHeight * this.pixelRatio;

    // Reset transform and scale context to match physical resolution
    this.ctx.resetTransform();
    if (this.pixelRatio !== 1) {
      this.ctx.scale(this.pixelRatio, this.pixelRatio);
    }

    this.isDirty = true;
  }

  public draw(currentTime: number, isActive: boolean, isHovered: boolean) {
    if (!this.layout) return;

    const stateUnchanged =
      !isActive &&
      !this.isDirty &&
      !this.lastIsActive &&
      this.lastIsHovered === isHovered;
    if (stateUnchanged) return;

    const { main, trans, mainHeight, transHeight } = getFonts(this.isMobile);
    const paddingX = this.isMobile ? 24 : 56;
    const hasTimedWords = this.layout.words.some((w) => w.isVerbatim);

    const stateChanged =
      this.lastIsActive !== isActive || this.lastIsHovered !== isHovered;
    if (isActive && !hasTimedWords && !this.isDirty && !stateChanged) {
      return;
    }

    const canIncremental =
      !this.isDirty && isActive && hasTimedWords && !stateChanged;

    let snapshots: Map<WordLayout, WordRenderSnapshot> | undefined;
    if (canIncremental) {
      snapshots = new Map<WordLayout, WordRenderSnapshot>();
      let needsWordUpdate = false;
      this.layout.words.forEach((word) => {
        const snapshot = this.computeWordSnapshot(word, currentTime);
        snapshots!.set(word, snapshot);
        if (!needsWordUpdate) {
          needsWordUpdate = this.shouldRedrawWord(word, snapshot, currentTime);
        }
      });

      if (!needsWordUpdate) {
        this.lastIsActive = isActive;
        this.lastIsHovered = isHovered;
        this.isDirty = false;
        return;
      }
    }

    this.drawFullLine({
      currentTime,
      isActive,
      isHovered,
      hasTimedWords,
      mainFont: main,
      transFont: trans,
      mainHeight,
      transHeight,
      paddingX,
      snapshots,
    });

    this.lastIsActive = isActive;
    this.lastIsHovered = isHovered;
    this.isDirty = false;
  }

  public getCanvas() {
    return this.canvas;
  }

  public getHeight() {
    return this._height;
  }

  public getLogicalWidth() {
    return this.logicalWidth;
  }

  public getLogicalHeight() {
    return this.logicalHeight;
  }

  // --- Helpers ---

  private measureLineText({
    line,
    segmenter,
    lang,
    maxWidth,
    baseSize,
    mainHeight,
    paddingY,
    mainFont,
  }: any) {
    this.ctx.font = mainFont;

    const words: WordLayout[] = [];
    let currentLineX = 0;
    let currentLineY = paddingY;
    let maxLineWidth = 0;

    const addWord = (
      text: string,
      start: number,
      end: number,
      isVerbatim: boolean,
    ) => {
      const metrics = this.ctx.measureText(text);
      let width = metrics.width;
      if (width === 0 && text.trim().length > 0) {
        width = text.length * (baseSize * 0.5);
      }

      if (currentLineX + width > maxWidth && currentLineX > 0) {
        currentLineX = 0;
        currentLineY += mainHeight;
      }

      const { charWidths, charOffsets } = this.computeCharMetrics(
        text,
        baseSize,
      );

      words.push({
        text,
        x: currentLineX,
        y: currentLineY,
        width,
        startTime: start,
        endTime: end,
        isVerbatim,
        charWidths,
        charOffsets,
      });

      currentLineX += width;
      maxLineWidth = Math.max(maxLineWidth, currentLineX);
    };

    if (line.words && line.words.length > 0) {
      line.words.forEach((w: any) => {
        addWord(w.text, w.startTime, w.endTime, true);
      });
    } else if (segmenter) {
      const segments = segmenter.segment(line.text);
      for (const seg of segments) {
        addWord(seg.segment, line.time, 999999, false);
      }
    } else if (lang === "zh") {
      line.text.split("").forEach((c: string) => {
        addWord(c, line.time, 999999, false);
      });
    } else {
      const wordsArr = line.text.split(" ");
      wordsArr.forEach((word: string, index: number) => {
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
  }

  private measureTranslationLines({
    translation,
    maxWidth,
    transHeight,
    transFont,
  }: any) {
    this.ctx.font = transFont;
    const isEn = detectLanguage(translation) === "en";
    const atoms = isEn ? translation.split(" ") : translation.split("");

    const lines: string[] = [];
    let currentTransLine = "";
    let currentTransWidth = 0;

    atoms.forEach((atom: string, index: number) => {
      const atomText = isEn && index < atoms.length - 1 ? atom + " " : atom;
      const width = this.ctx.measureText(atomText).width;

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
  }

  private drawLyricWord(word: WordLayout, currentTime: number) {
    this.ctx.save();
    this.ctx.translate(word.x, word.y);

    const duration = word.endTime - word.startTime;
    const elapsed = currentTime - word.startTime;
    const { mainHeight } = getFonts(this.isMobile);

    if (currentTime < word.startTime) {
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      this.ctx.fillText(word.text, 0, 0);
      word.renderProgress = 0;
      this.ctx.restore();
      return;
    } else if (currentTime > word.endTime) {
      word.renderProgress = 1;
      this.drawStandardAnimation(word, 1, mainHeight);
      this.ctx.restore();
      return;
    } else {
      let progress = 0;
      if (duration > 0) {
        progress = Math.max(0, Math.min(1, elapsed / duration));
      }
      const easedProgress = this.easeProgress(word, progress);

      const useGlow = this.shouldUseGlow(word, duration);
      if (useGlow) {
        this.drawGlowAnimation(word, currentTime, elapsed, duration);
      } else {
        this.drawStandardAnimation(word, easedProgress, mainHeight);
      }
    }

    this.ctx.restore();
  }

  private drawGlowAnimation(
    word: WordLayout,
    currentTime: number,
    elapsed: number,
    duration: number,
  ) {
    const chars = word.text.split("");
    if (chars.length === 0) {
      this.ctx.fillText(word.text, 0, 0);
      return;
    }

    const charCount = chars.length;
    const baseTimePerChar =
      charCount <= 3 ? 0.25 : charCount <= 5 ? 0.25 : 0.18;
    const MAX_GLOW_DURATION = Math.max(1.0, charCount * baseTimePerChar);
    const effectiveDuration = Math.min(duration, MAX_GLOW_DURATION);
    const TRANSITION_DURATION = 0.3; // Transition period to smoothly return to original position
    const isAnimating = elapsed < effectiveDuration;
    const isTransitioning =
      elapsed >= effectiveDuration &&
      elapsed < effectiveDuration + TRANSITION_DURATION;

    const spread = duration;

    let effectiveP = 0;
    if (effectiveDuration > 0) {
      const rawP = Math.max(0, Math.min(1, elapsed / effectiveDuration));
      effectiveP = 1 - Math.pow(1 - rawP, 3);
    }
    if (!isAnimating && !isTransitioning) effectiveP = 1;

    const normalizedProgress = Math.max(0, Math.min(1, effectiveP));
    let lifeWeight = Math.sin(normalizedProgress * Math.PI);

    // Apply smooth transition when animation ends
    if (isTransitioning) {
      const transitionElapsed = elapsed - effectiveDuration;
      const transitionProgress = transitionElapsed / TRANSITION_DURATION;
      // Ease out cubic for smooth deceleration
      const easedTransition = 1 - Math.pow(1 - transitionProgress, 3);
      lifeWeight *= 1 - easedTransition; // Smoothly reduce lifeWeight to 0
    }

    const baseBlur = charCount <= 3 ? 28 : charCount <= 5 ? 22 : 18;
    const breathBlur = baseBlur * (0.4 + 0.6 * lifeWeight);

    const breathScaleAmount =
      charCount <= 3 ? 0.035 : charCount <= 5 ? 0.025 : 0.018;
    const breathScale = 1.0 + breathScaleAmount * lifeWeight;
    const breathLiftAmount = charCount <= 3 ? 1.9 : charCount <= 5 ? 1.4 : 1.1;
    const breathLift = breathLiftAmount * lifeWeight;

    this.ctx.shadowColor = isAnimating
      ? `rgba(255, 255, 255, ${0.55 + 0.3 * lifeWeight})`
      : `rgba(255, 255, 255, ${0.3 * lifeWeight})`;
    this.ctx.shadowBlur = breathBlur;

    const activeIndex = effectiveP * (chars.length + spread * 2) - spread;

    if (!word.charWidths || !word.charOffsets) {
      const { charWidths, charOffsets } = this.computeCharMetrics(
        word.text,
        getFonts(this.isMobile).mainHeight,
      );
      word.charWidths = charWidths;
      word.charOffsets = charOffsets;
    }

    this.ctx.save();
    this.ctx.fillStyle = `rgba(255, 255, 255, ${0.35 + 0.25 * lifeWeight})`;
    this.ctx.fillText(word.text, 0, 0);
    this.ctx.restore();

    this.ctx.save();
    this.ctx.translate(0, -breathLift);

    chars.forEach((char, charIndex) => {
      const charWidth =
        word.charWidths?.[charIndex] ?? this.ctx.measureText(char).width;
      const charX = word.charOffsets?.[charIndex] ?? 0;
      const dist = Math.abs(charIndex - activeIndex);

      const gaussian = Math.exp(-(dist * dist) / (2 * spread * spread));
      const glowStrength = gaussian * lifeWeight;

      const charNormalizedPos = charIndex / Math.max(1, chars.length - 1);
      const activationProgress = effectiveP;

      const activationWindow = charCount <= 3 ? 0.4 : 0.3;
      const charActivationStart = charNormalizedPos - activationWindow;
      const charActivationEnd = charNormalizedPos + activationWindow;

      let charActivation = 0;
      if (activationProgress < charActivationStart) {
        charActivation = 0;
      } else if (activationProgress > charActivationEnd) {
        charActivation = 1;
      } else {
        const t =
          (activationProgress - charActivationStart) /
          (charActivationEnd - charActivationStart);
        charActivation = t * t * (3 - 2 * t);
      }

      this.ctx.save();
      this.ctx.translate(charX, 0);

      const intensity = Math.max(charActivation, glowStrength);
      const brightness = Math.max(0.45, Math.min(1.0, 0.45 + intensity * 0.55));
      this.ctx.fillStyle =
        charActivation > 0.9 ? "#ffffff" : `rgba(255, 255, 255, ${brightness})`;

      this.ctx.fillText(char, 0, 0);
      this.ctx.restore();
    });

    this.ctx.restore();

    this.ctx.shadowBlur = 0;
    this.ctx.shadowColor = "transparent";
  }

  private drawStandardAnimation(
    word: WordLayout,
    progress: number,
    mainHeight: number,
  ) {
    // If animation is complete, draw the full word flat and exit
    if (progress >= 1) {
      this.ctx.save();
      this.ctx.fillStyle = "#ffffff"; // Full highlight color
      this.ctx.fillText(word.text, 0, -2);
      this.ctx.restore();
      return;
    }

    const highlightWidth = Math.max(
      0,
      Math.min(word.width, word.width * progress),
    );
    const remainingWidth = Math.max(0, word.width - highlightWidth);

    // Calculate animation values
    const easeVal = this.easeInOutCubic(progress);
    const maxSkew = 0.00035;
    const skewX = maxSkew * (1 - easeVal);
    const liftMax = -2;
    const lift = liftMax * easeVal;

    // Apply transform to the ENTIRE word context
    this.ctx.save();
    this.ctx.translate(0, lift);
    this.ctx.transform(1, 0, -skewX, 1, 0, 0);

    // Draw inactive part (clipped)
    if (remainingWidth > 0) {
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.rect(
        highlightWidth - 1,
        -mainHeight * 0.2,
        remainingWidth + 2,
        mainHeight * 1.35,
      );
      this.ctx.clip();
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
      this.ctx.fillText(word.text, 0, 0);
      this.ctx.restore();
    }

    // Draw active part (clipped)
    if (highlightWidth > 0.25) {
      const gradientWidth = Math.max(word.width, 1);
      const fillGradient = this.ctx.createLinearGradient(
        0,
        0,
        gradientWidth,
        0,
      );
      fillGradient.addColorStop(0, "#ffffff");
      fillGradient.addColorStop(1, "rgba(255, 255, 255, 0.65)");

      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.rect(-2, -mainHeight * 0.2, highlightWidth + 4, mainHeight * 1.35);
      this.ctx.clip();
      this.ctx.fillStyle = fillGradient;
      this.ctx.fillText(word.text, 0, 0);
      this.ctx.restore();
    }

    this.ctx.restore();
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    this.ctx.beginPath();
    this.ctx.moveTo(x + r, y);
    this.ctx.arcTo(x + w, y, x + w, y + h, r);
    this.ctx.arcTo(x + w, y + h, x, y + h, r);
    this.ctx.arcTo(x, y + h, x, y, r);
    this.ctx.arcTo(x, y, x + w, y, r);
    this.ctx.closePath();
  }

  private computeCharMetrics(text: string, baseSize: number) {
    const chars = text.split("");
    const charWidths: number[] = [];
    const charOffsets: number[] = [];
    let offset = 0;

    chars.forEach((char) => {
      const width =
        this.ctx.measureText(char).width || char.length * (baseSize * 0.5);
      charWidths.push(width);
      charOffsets.push(offset);
      offset += width;
    });

    return { charWidths, charOffsets };
  }

  private easeProgress(word: WordLayout, target: number) {
    if (word.renderProgress === undefined) {
      word.renderProgress = target;
    } else {
      word.renderProgress += (target - word.renderProgress) * 0.25;
    }
    return Math.max(0, Math.min(1, word.renderProgress));
  }

  private easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}
