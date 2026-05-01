import React from 'react';

import { MAX_BRUSH_COLOR_CYCLE_SPEED } from '@/constants/colorCycle';
import { GradientPalette } from '@/lib/GradientPalette';

const PREVIEW_PALETTE_SIZE = 256;

type CcSampledGradientPreviewProps = {
  stops: Array<{ position: number; color: string; opacity?: number }>;
  speed: number;
  flowMode?: 'forward' | 'reverse' | 'pingpong' | 'bounce' | 'backward';
  isPaused: boolean;
};

export const CcSampledGradientPreview = ({
  stops,
  speed,
  flowMode,
  isPaused,
}: CcSampledGradientPreviewProps) => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const canvasCtxRef = React.useRef<CanvasRenderingContext2D | null>(null);
  const paletteRef = React.useRef<Uint8ClampedArray | null>(null);
  const stripCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const stripCtxRef = React.useRef<CanvasRenderingContext2D | null>(null);
  const stripImageRef = React.useRef<ImageData | null>(null);
  const stripDataRef = React.useRef<Uint8ClampedArray | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const t0Ref = React.useRef<number | null>(null);
  const pausePhaseRef = React.useRef<number>(0);
  const lastPhaseRef = React.useRef<number>(0);
  const isPausedRef = React.useRef<boolean>(isPaused);
  isPausedRef.current = isPaused;

  React.useEffect(() => {
    try {
      const palette = new GradientPalette(stops);
      paletteRef.current = palette.getPaletteColors();
    } catch {
      paletteRef.current = null;
    }
  }, [stops]);

  React.useEffect(() => {
    if (!stripCanvasRef.current) {
      const stripCanvas = document.createElement('canvas');
      stripCanvas.width = PREVIEW_PALETTE_SIZE;
      stripCanvas.height = 1;
      stripCanvasRef.current = stripCanvas;
      stripCtxRef.current = stripCanvas.getContext('2d', { willReadFrequently: false });
    }
    if (!stripDataRef.current) {
      stripDataRef.current = new Uint8ClampedArray(PREVIEW_PALETTE_SIZE * 4);
    }
    if (!stripImageRef.current && stripCtxRef.current) {
      stripImageRef.current = stripCtxRef.current.createImageData(PREVIEW_PALETTE_SIZE, 1);
    }
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    canvas.width = PREVIEW_PALETTE_SIZE;
    canvas.height = 24;
    canvasCtxRef.current = canvas.getContext('2d', { willReadFrequently: false });
  }, []);

  const drawFrame = React.useCallback((phase: number) => {
    const canvas = canvasRef.current;
    const ctx = canvasCtxRef.current;
    const palette = paletteRef.current;
    const stripData = stripDataRef.current;
    const stripImage = stripImageRef.current;
    const stripCtx = stripCtxRef.current;
    const stripCanvas = stripCanvasRef.current;
    if (!canvas || !ctx || !palette || !stripData || !stripImage || !stripCtx || !stripCanvas) {
      return;
    }

    const shift = (Math.floor(phase * PREVIEW_PALETTE_SIZE) & 255) * 4;
    for (let i = 0; i < PREVIEW_PALETTE_SIZE; i += 1) {
      const src = (shift + i * 4) & (PREVIEW_PALETTE_SIZE * 4 - 1);
      const dst = i * 4;
      stripData[dst] = palette[src];
      stripData[dst + 1] = palette[src + 1];
      stripData[dst + 2] = palette[src + 2];
      stripData[dst + 3] = palette[src + 3];
    }

    stripImage.data.set(stripData);
    stripCtx.putImageData(stripImage, 0, 0);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(stripCanvas, 0, 0, stripCanvas.width, stripCanvas.height, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }, []);

  React.useEffect(() => {
    const resolvedSpeed = Math.max(0, Math.min(MAX_BRUSH_COLOR_CYCLE_SPEED, Math.abs(speed)));
    const direction = flowMode === 'reverse' || flowMode === 'backward' ? -1 : 1;
    const effectiveSpeed = resolvedSpeed * direction;
    const canAnimate =
      typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function';

    const stop = () => {
      if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    const tick = (timestamp: number) => {
      const tSeconds = timestamp / 1000;
      if (t0Ref.current === null) {
        t0Ref.current = tSeconds;
      }
      let phase = pausePhaseRef.current;
      if (!isPausedRef.current) {
        const raw = (tSeconds - t0Ref.current) * effectiveSpeed;
        phase = ((raw % 1) + 1) % 1;
        pausePhaseRef.current = phase;
      }
      lastPhaseRef.current = phase;
      drawFrame(phase);
      rafRef.current = requestAnimationFrame(tick);
    };

    stop();
    if (resolvedSpeed > 0 && !isPaused && canAnimate) {
      const nowSeconds = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      if (effectiveSpeed !== 0) {
        t0Ref.current = nowSeconds - pausePhaseRef.current / effectiveSpeed;
      } else {
        t0Ref.current = nowSeconds;
      }
      rafRef.current = requestAnimationFrame(tick);
      return () => stop();
    }

    drawFrame(lastPhaseRef.current);
    return () => stop();
  }, [drawFrame, flowMode, isPaused, speed]);

  return (
    <canvas
      ref={canvasRef}
      className="h-6 w-full rounded border border-white/10"
      style={{ imageRendering: 'pixelated' }}
    />
  );
};
