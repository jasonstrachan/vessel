import type { BrushSettings } from '@/types';

type CanvasPoolLike = {
  acquire: (width: number, height: number) => HTMLCanvasElement;
  release: (canvas: HTMLCanvasElement) => void;
};

export type ApplyColorCycleRisographOverlayArgs = {
  ctx: CanvasRenderingContext2D;
  sourceCanvas: HTMLCanvasElement | OffscreenCanvas;
  outputOpacity: number;
  brushSettings: Pick<
    BrushSettings,
    'risographIntensity' | 'risographColorShift' | 'color' | 'ditherEnabled'
  >;
  canvasPool: CanvasPoolLike;
  getRisographPattern: (ctx: CanvasRenderingContext2D) => CanvasPattern | null;
  getRisographEffectSettings: (
    intensity: number,
    options: { isPixelBrush: boolean }
  ) => { alpha: number; jitter: number };
  getRisographFilter: (color: string, amount: number, rng: () => number) => string;
  hashNumbers: (...values: number[]) => number;
  createSeededRng: (seed: number) => () => number;
};

export const applyColorCycleRisographOverlay = ({
  ctx,
  sourceCanvas,
  outputOpacity,
  brushSettings,
  canvasPool,
  getRisographPattern,
  getRisographEffectSettings,
  getRisographFilter,
  hashNumbers,
  createSeededRng,
}: ApplyColorCycleRisographOverlayArgs): void => {
  const intensity = brushSettings.risographIntensity || 0;
  if (intensity <= 0) {
    return;
  }

  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  if (!width || !height) {
    return;
  }

  const pattern = getRisographPattern(ctx);
  if (!pattern) {
    return;
  }

  const effect = getRisographEffectSettings(intensity, { isPixelBrush: false });
  if (effect.alpha <= 0) {
    return;
  }

  const normalizedIntensity = Math.max(0, Math.min(1, intensity / 100));
  const overlayBase = outputOpacity * (0.12 + normalizedIntensity * 0.08);
  const overlayStrength = Math.min(1, brushSettings.ditherEnabled ? Math.max(overlayBase, 0.28) : overlayBase);
  if (overlayStrength <= 0.01) {
    return;
  }

  const tempCanvas = canvasPool.acquire(width, height);
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  if (!tempCtx) {
    canvasPool.release(tempCanvas);
    return;
  }

  tempCtx.imageSmoothingEnabled = false;
  tempCtx.setTransform(1, 0, 0, 1, 0, 0);
  tempCtx.globalCompositeOperation = 'source-over';
  tempCtx.globalAlpha = 1;
  tempCtx.clearRect(0, 0, width, height);
  tempCtx.drawImage(sourceCanvas as CanvasImageSource, 0, 0, width, height);
  tempCtx.globalCompositeOperation = 'source-in';
  tempCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  tempCtx.fillRect(0, 0, width, height);

  const seed = hashNumbers(width, height, intensity, brushSettings.risographColorShift ?? 3);
  const rng = createSeededRng(seed);
  const misregX = (rng() - 0.5) * effect.jitter;
  const misregY = (rng() - 0.5) * effect.jitter;
  const rotation = (rng() - 0.5) * 0.08;
  const scale = 1 + (rng() - 0.5) * 0.04;
  const filter = getRisographFilter(
    brushSettings.color || '#000',
    brushSettings.risographColorShift ?? 3,
    rng
  );

  tempCtx.translate(misregX, misregY);
  tempCtx.globalCompositeOperation = 'source-over';
  tempCtx.globalAlpha = 1;
  tempCtx.translate(width / 2, height / 2);
  tempCtx.rotate(rotation);
  tempCtx.scale(scale, scale);
  tempCtx.translate(-width / 2, -height / 2);
  tempCtx.filter = filter;
  tempCtx.fillStyle = pattern;
  tempCtx.fillRect(-misregX, -misregY, width, height);
  tempCtx.setTransform(1, 0, 0, 1, 0, 0);
  tempCtx.globalCompositeOperation = 'source-over';
  tempCtx.filter = 'none';

  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = overlayStrength;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tempCanvas, 0, 0, width, height);
  ctx.restore();

  canvasPool.release(tempCanvas);
};
