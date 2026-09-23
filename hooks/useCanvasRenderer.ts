import { useEffect, useLayoutEffect, useRef } from "react";
import { usePageActive } from "./usePageActive";

interface UseCanvasRendererProps {
  onRender: (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    deltaTime: number,
  ) => void;
  targetFps?: number;
  maxDpr?: number;
}

export const useCanvasRenderer = ({
  onRender,
  targetFps = 60,
  maxDpr = 1.5,
}: UseCanvasRendererProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef(0);
  const previousTimeRef = useRef<number>();
  const dprRef = useRef(1);
  const active = usePageActive();

  // Use a ref to store the latest callback to avoid restarting the animation loop.
  const onRenderRef = useRef(onRender);

  useLayoutEffect(() => {
    onRenderRef.current = onRender;
  });

  useEffect(() => {
    if (!active) {
      previousTimeRef.current = undefined;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;

      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      const rect = parent.getBoundingClientRect();
      const width = Math.round(rect.width * dpr);
      const height = Math.round(rect.height * dpr);
      dprRef.current = dpr;

      if (canvas.width === width && canvas.height === height) return;

      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.resetTransform();
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener("resize", resize);

    const interval = 1000 / Math.max(1, targetFps);
    const animate = (time: number) => {
      const previous = previousTimeRef.current;
      if (previous === undefined) {
        previousTimeRef.current = time;
      } else if (time - previous >= interval) {
        const delta = time - previous;
        previousTimeRef.current = time - ((time - previous) % interval);
        const width = canvas.width / dprRef.current;
        const height = canvas.height / dprRef.current;

        ctx.clearRect(0, 0, width, height);
        onRenderRef.current(ctx, width, height, delta);
      }

      requestRef.current = requestAnimationFrame(animate);
    };

    previousTimeRef.current = undefined;
    requestRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(requestRef.current);
    };
  }, [active, maxDpr, targetFps]);

  return canvasRef;
};
