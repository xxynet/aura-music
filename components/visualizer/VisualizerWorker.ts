// VisualizerWorker.ts

export type WorkerMessage =
    | { type: "INIT"; canvas: OffscreenCanvas; config: VisualizerConfig; port: MessagePort }
    | { type: "AUDIO_DATA"; data: Float32Array }
    | { type: "RESIZE"; width: number; height: number }
    | { type: "DESTROY" };

export interface VisualizerConfig {
    barCount: number;
    gap: number;
    fftSize: number;
    smoothingTimeConstant: number;
    dpr?: number;
}

const ctx: Worker = self as any;

console.log("VisualizerWorker: Worker script loaded");

let canvas: OffscreenCanvas | null = null;
let canvasCtx: OffscreenCanvasRenderingContext2D | null = null;
let config: VisualizerConfig | null = null;
let animationFrameId: number | null = null;
let workletPort: MessagePort | null = null;

// Ring buffer for smoothing/history
const BUFFER_SIZE = 2048; // Store enough history for a nice wave
const historyBuffer = new Float32Array(BUFFER_SIZE);
let historyIndex = 0;

ctx.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const { type } = e.data;
    console.log("VisualizerWorker: Received message", type);

    switch (type) {
        case 'INIT': {
             const payload = e.data as { type: "INIT"; canvas: OffscreenCanvas; config: VisualizerConfig; port: MessagePort };
            console.log("VisualizerWorker: Initializing...");
            canvas = payload.canvas;
            config = payload.config;
            canvasCtx = canvas.getContext('2d');
            console.log("VisualizerWorker: Canvas context created", !!canvasCtx);

            // Setup port to worklet
            workletPort = payload.port;
            console.log("VisualizerWorker: Port received");
            workletPort.onmessage = (ev) => {
                 if (ev.data.type === "AUDIO_DATA") {
                    const newData = ev.data.data as Float32Array;
                    // Write to ring buffer
                    for (let i = 0; i < newData.length; i++) {
                        historyBuffer[historyIndex] = newData[i];
                        historyIndex = (historyIndex + 1) % BUFFER_SIZE;
                    }
                }
            };

            startLoop();
            break;
        }
        case 'AUDIO_DATA': {
            // This case is now handled by the workletPort.onmessage handler
            break;
        }
        case 'RESIZE': {
             const payload = e.data as { type: "RESIZE"; width: number; height: number };
            if (canvas) {
                canvas.width = payload.width;
                canvas.height = payload.height;
            }
            break;
        }
        case 'DESTROY': {
            console.log("VisualizerWorker: Destroying");
            if (animationFrameId !== null) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            if (workletPort) {
                workletPort.close();
            }
            canvas = null;
            canvasCtx = null;
            break;
        }
    }
};

function startLoop() {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);

  let last = 0;
  const interval = 1000 / 30;
  const loop = (now: number) => {
    const elapsed = now - last;
    if (elapsed >= interval && canvas && canvasCtx && config) {
      last = now - (elapsed % interval);
      draw(canvasCtx, canvas.width, canvas.height);
    }
    animationFrameId = requestAnimationFrame(loop);
  };

  animationFrameId = requestAnimationFrame(loop);
}

// Reuse analysis buffers so the visualizer does not create garbage every frame.
let bars: number[] = [];
let recent = new Float32Array(0);
let targets: number[] = [];
let smooth: number[] = [];

function draw(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  if (!config) return;

  const { barCount, gap, fftSize, dpr = 1 } = config;
  const size = Math.max(256, Math.min(fftSize, BUFFER_SIZE));
  if (recent.length !== size) recent = new Float32Array(size);
  if (bars.length !== barCount) {
    bars = new Array(barCount).fill(0);
    targets = new Array(barCount).fill(0);
    smooth = new Array(barCount).fill(0);
  }

  for (let i = 0; i < size; i += 1) {
    const index = (historyIndex - size + i + BUFFER_SIZE) % BUFFER_SIZE;
    recent[i] = historyBuffer[index];
  }

  const step = Math.max(1, Math.floor(size / barCount));
  for (let i = 0; i < barCount; i += 1) {
    let peak = 0;
    const start = i * step;
    for (let j = 0; j < step && start + j < size; j += 1) {
      peak = Math.max(peak, Math.abs(recent[start + j] || 0));
    }
    targets[barCount - i - 1] = peak;
  }

  for (let i = 0; i < barCount; i += 1) {
    if (i < 3 || i >= barCount - 3) {
      smooth[i] = targets[i];
      continue;
    }
    smooth[i] = Math.max(
      0,
      (-2 * targets[i - 3] +
        3 * targets[i - 2] +
        6 * targets[i - 1] +
        7 * targets[i] +
        6 * targets[i + 1] +
        3 * targets[i + 2] -
        2 * targets[i + 3]) /
        21,
    );
  }

  const h = height / dpr;
  const w = width / dpr;
  const barWidth = Math.max(
    2,
    (w - gap * Math.max(0, barCount - 1)) / barCount,
  );
  const span = barWidth + gap;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();

  for (let i = 0; i < barCount; i += 1) {
    bars[i] += (smooth[i] - bars[i]) * 0.28;
    const barHeight = Math.max(4, Math.min(1, bars[i]) * h);
    ctx.roundRect(i * span, h - barHeight, barWidth, barHeight, barWidth / 2);
  }

  ctx.fill();
  ctx.restore();
}
