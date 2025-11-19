import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  audioRef: React.RefObject<HTMLAudioElement>;
  isPlaying: boolean;
}

// Global map to store source nodes to prevent "MediaElementAudioSourceNode" double-connection errors
// if the component remounts while the audio element persists.
const sourceMap = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();
const contextMap = new WeakMap<HTMLAudioElement, AudioContext>();

const Visualizer: React.FC<VisualizerProps> = ({ audioRef, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    // Initialize Audio Context
    const initAudio = () => {
        if (!audioRef.current) return;
        const audioEl = audioRef.current;

        let ctx = contextMap.get(audioEl);
        if (!ctx) {
            ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            contextMap.set(audioEl, ctx);
        }

        if (ctx.state === 'suspended' && isPlaying) {
            ctx.resume();
        }

        if (!analyserRef.current) {
            analyserRef.current = ctx.createAnalyser();
            // FFT Size determines the number of bars. 64 = 32 bars, nice and chunky.
            analyserRef.current.fftSize = 128; 
            analyserRef.current.smoothingTimeConstant = 0.8;
        }

        if (!sourceMap.has(audioEl)) {
            try {
                const source = ctx.createMediaElementSource(audioEl);
                source.connect(analyserRef.current);
                analyserRef.current.connect(ctx.destination);
                sourceMap.set(audioEl, source);
            } catch (e) {
                console.error("Audio source connection failed", e);
            }
        }
    };

    if (isPlaying) {
        initAudio();
        draw();
    } else {
        cancelAnimationFrame(rafRef.current);
    }

    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, audioRef]);

  const draw = () => {
    if (!canvasRef.current || !analyserRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Visualizer Settings
    const barCount = 40; // Limit bars drawn for aesthetic spacing
    const gap = 4;
    const totalGap = gap * (barCount - 1);
    const barWidth = (canvas.width - totalGap) / barCount;

    // Draw
    for (let i = 0; i < barCount; i++) {
        // Skip low frequencies which are often too loud/static
        const dataIndex = Math.floor(i * (bufferLength / barCount));
        const value = dataArray[dataIndex];
        
        // Scale height slightly
        const percent = value / 255;
        const height = Math.max(4, percent * canvas.height); // Min height 4px
        
        const x = i * (barWidth + gap);
        const y = (canvas.height - height) / 2; // Center vertically

        // Style
        ctx.fillStyle = `rgba(255, 255, 255, ${0.2 + percent * 0.6})`;
        
        // Rounded Rect manually for compatibility
        ctx.beginPath();
        if (ctx.roundRect) {
             ctx.roundRect(x, y, barWidth, height, 4);
        } else {
             ctx.rect(x, y, barWidth, height);
        }
        ctx.fill();
    }

    rafRef.current = requestAnimationFrame(draw);
  };

  if (!isPlaying) return <div className="h-8 w-full"></div>;

  return (
    <canvas 
        ref={canvasRef} 
        width={320} 
        height={32} 
        className="w-full max-w-[320px] h-8 transition-opacity duration-500"
    />
  );
};

export default Visualizer;