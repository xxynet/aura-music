import React, { useRef, useEffect } from 'react';

interface FluidBackgroundProps {
  colors: string[];
  coverUrl?: string;
  isPlaying: boolean;
}

const FluidBackground: React.FC<FluidBackgroundProps> = ({ colors, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  
  // Time tracking for pause/resume
  const timeRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const isPlayingRef = useRef(isPlaying);

  // Sync ref to avoid effect re-trigger
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Fallback colors
  const defaultColors = [
    'rgb(60, 20, 80)',
    'rgb(100, 40, 60)',
    'rgb(20, 20, 40)',
    'rgb(40, 40, 90)'
  ];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const gl = canvas.getContext('webgl');
    if (!gl) {
        console.error("WebGL not supported");
        return;
    }

    // --------------------------------------------------------
    // 1. SHADER SOURCES
    // --------------------------------------------------------

    const vertexShaderSource = `
      attribute vec2 position;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;

    const fragmentShaderSource = `
      precision highp float;
      
      uniform vec2 uResolution;
      uniform float uTime;
      uniform sampler2D uTexture; // Holds the color palette gradient

      // Random function
      float rand(vec2 n) { 
          return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
      }

      // Cubic Noise function
      float noise(vec2 p){
          vec2 ip = floor(p);
          vec2 u = fract(p);
          u = u*u*(3.0-2.0*u); // Cubic smoothstep

          float res = mix(
              mix(rand(ip),rand(ip+vec2(1.0,0.0)),u.x),
              mix(rand(ip+vec2(0.0,1.0)),rand(ip+vec2(1.0,1.0)),u.x),u.y);
          return res*res;
      }

      const mat2 mtx = mat2( 0.80,  0.60, -0.60,  0.80 );

      // Fractional Brownian Motion
      float fbm( vec2 p ) {
          float f = 0.0;

          // Octaves with standard decay for softer details
          f += 0.500000 * noise( p + uTime * 0.5 ); p = mtx * p * 2.02;
          f += 0.250000 * noise( p ); p = mtx * p * 2.03;
          f += 0.125000 * noise( p ); p = mtx * p * 2.01;
          f += 0.062500 * noise( p ); p = mtx * p * 2.04;
          
          return f / 0.9375;
      }

      // Domain Warping Pattern
      float pattern( in vec2 p ) {
          // Reduced warping strength (0.6 / 0.5) to soften transitions
          return fbm( p + 0.6 * fbm( p + 0.5 * fbm( p ) ) );
      }

      void main() {
          vec2 uv = gl_FragCoord.xy / uResolution.xy;
          // Correct aspect ratio
          uv.x *= uResolution.x / uResolution.y;
          
          // Zoom out slightly for larger, softer shapes
          uv *= 0.6;

          float shade = pattern(uv);
          
          // Smoothstep to remove harsh extremes
          shade = smoothstep(0.0, 1.0, shade);
          
          // Map the noise value (shade) to our dynamic color gradient texture
          // clamp ensures we don't wrap around the texture edge
          vec4 color = texture2D(uTexture, vec2(clamp(shade, 0.001, 0.999), 0.5));

          gl_FragColor = vec4(color.rgb, 1.0);
      }
    `;

    // --------------------------------------------------------
    // 2. COMPILE SHADERS
    // --------------------------------------------------------
    
    const createShader = (gl: WebGLRenderingContext, type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.useProgram(program);

    // --------------------------------------------------------
    // 3. SETUP GEOMETRY
    // --------------------------------------------------------

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = [
      -1.0, -1.0,
       1.0, -1.0,
      -1.0,  1.0,
      -1.0,  1.0,
       1.0, -1.0,
       1.0,  1.0,
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    const positionAttributeLocation = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(positionAttributeLocation);
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

    // --------------------------------------------------------
    // 4. GENERATE GRADIENT TEXTURE
    // --------------------------------------------------------

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const updateTexture = () => {
        const activeColors = (colors && colors.length > 0) ? colors : defaultColors;
        const width = 512;
        const height = 1;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const ctx = tempCanvas.getContext('2d');
        
        if (ctx) {
            const grad = ctx.createLinearGradient(0, 0, width, 0);
            // Distribute colors evenly
            activeColors.forEach((c, i) => {
                grad.addColorStop(i / Math.max(1, activeColors.length - 1), c);
            });
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, width, height);

            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tempCanvas);
        }
    };

    updateTexture();

    // --------------------------------------------------------
    // 5. RENDER LOOP
    // --------------------------------------------------------

    const resolutionUniformLocation = gl.getUniformLocation(program, "uResolution");
    const timeUniformLocation = gl.getUniformLocation(program, "uTime");
    const textureUniformLocation = gl.getUniformLocation(program, "uTexture");

    const render = (now: number) => {
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
         canvas.width = canvas.clientWidth;
         canvas.height = canvas.clientHeight;
         gl.viewport(0, 0, canvas.width, canvas.height);
      }

      gl.useProgram(program);
      gl.uniform2f(resolutionUniformLocation, canvas.width, canvas.height);
      
      // Delta time calculation for smooth pause/resume
      const dt = now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;

      if (isPlayingRef.current) {
         timeRef.current += dt;
      }
      
      // Speed factor: 0.0005
      gl.uniform1f(timeUniformLocation, timeRef.current * 0.0005); 
      gl.uniform1i(textureUniformLocation, 0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      animationRef.current = requestAnimationFrame(render);
    };

    // Init time to avoid huge jump on first frame
    lastFrameTimeRef.current = performance.now();
    requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [colors]);

  return (
    <>
        <canvas 
            ref={canvasRef} 
            className="fixed inset-0 w-full h-full bg-black"
        />
        {/* Subtle noise overlay for texture */}
        <div className="fixed inset-0 w-full h-full pointer-events-none opacity-[0.03] mix-blend-overlay"
             style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`
             }}
        ></div>
    </>
  );
};

export default FluidBackground;