import type { Point2D, RectangleGradientSettings } from './shapeTypes';
import { spreadPaletteColors } from './engineShared';

type CanvasPoolLike = {
  acquire: (width: number, height: number) => HTMLCanvasElement;
  release: (canvas: HTMLCanvasElement) => void;
};

export type DrawRectangleGradientArgs = {
  ctx: CanvasRenderingContext2D;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  width: number;
  colors: string[];
  isPreview?: boolean;
  isPixelBrush: boolean;
  brushSettings: RectangleGradientSettings;
  withTransparencyLock: (ctx: CanvasRenderingContext2D, draw: () => void) => void;
  setBlendIfUnlocked: (ctx: CanvasRenderingContext2D) => void;
  setMultiplyIfUnlocked: (ctx: CanvasRenderingContext2D) => void;
  applyDithering: (
    imageData: ImageData,
    numColors: number,
    algorithm?: string,
    patternStyle?: string,
    customPalette?: string[]
  ) => ImageData;
  applyDitheringWithFillResolution: (
    imageData: ImageData,
    numColors: number,
    fillResolution: number,
    algorithm?: string,
    patternStyle?: string,
    customPalette?: string[]
  ) => ImageData;
  canvasPool: CanvasPoolLike;
  getRisographPattern: (ctx: CanvasRenderingContext2D) => CanvasPattern | null;
  getRisographEffectSettings: (
    intensity: number,
    options: { isPixelBrush: boolean }
  ) => { alpha: number; jitter: number };
  getRisographFilter: (
    color: string,
    amount: number,
    rng: () => number
  ) => string;
  createSeededRng: (seed: number) => () => number;
  hashNumbers: (...values: number[]) => number;
  createRisoTintMask: (
    width: number,
    height: number,
    isPixelBrush: boolean,
    rng: () => number
  ) => HTMLCanvasElement | undefined;
};

const addGradientStops = (gradient: CanvasGradient, colors: string[], fallbackColor: string) => {
  if (colors.length > 0) {
    if (colors.length === 1) {
      gradient.addColorStop(0, colors[0]);
      gradient.addColorStop(1, colors[0]);
      return;
    }

    colors.forEach((color, index) => {
      const position = index / (colors.length - 1);
      gradient.addColorStop(position, color);
    });
    return;
  }

  gradient.addColorStop(0, fallbackColor);
  gradient.addColorStop(1, fallbackColor);
};

const drawPolygonPath = (
  ctx: CanvasRenderingContext2D,
  corners: Point2D[],
  roundPoints: boolean
) => {
  if (roundPoints) {
    ctx.moveTo(Math.round(corners[0].x), Math.round(corners[0].y));
    corners.slice(1).forEach((corner) => {
      ctx.lineTo(Math.round(corner.x), Math.round(corner.y));
    });
    return;
  }

  ctx.moveTo(corners[0].x, corners[0].y);
  corners.slice(1).forEach((corner) => {
    ctx.lineTo(corner.x, corner.y);
  });
};

export const drawRectangleGradient = ({
  ctx,
  startX,
  startY,
  endX,
  endY,
  width,
  colors,
  isPreview = false,
  isPixelBrush,
  brushSettings,
  withTransparencyLock,
  setBlendIfUnlocked,
  setMultiplyIfUnlocked,
  applyDithering,
  applyDitheringWithFillResolution,
  canvasPool,
  getRisographPattern,
  getRisographEffectSettings,
  getRisographFilter,
  createSeededRng,
  hashNumbers,
  createRisoTintMask,
}: DrawRectangleGradientArgs): void => {
  if (typeof window !== 'undefined') {
    const cx = (startX + endX) / 2;
    const cy = (startY + endY) / 2;
    window.__AL_sample = { x: cx, y: cy, tag: 'rectGrad' };
  }

  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.hypot(dx, dy);

  if (length === 0 || width === 0) {
    return;
  }

  const perpX = (-dy / length) * (width / 2);
  const perpY = (dx / length) * (width / 2);

  const corners = [
    { x: startX + perpX, y: startY + perpY },
    { x: startX - perpX, y: startY - perpY },
    { x: endX - perpX, y: endY - perpY },
    { x: endX + perpX, y: endY + perpY },
  ];

  withTransparencyLock(ctx, () => {
    ctx.save();

    ctx.imageSmoothingEnabled = !isPixelBrush;
    ctx.globalAlpha = brushSettings.opacity;
    setBlendIfUnlocked(ctx);

    const gradient = ctx.createLinearGradient(startX, startY, endX, endY);
    addGradientStops(gradient, colors, brushSettings.color);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    drawPolygonPath(ctx, corners, false);
    ctx.closePath();
    ctx.fill();

    if (brushSettings.ditherEnabled && !isPreview) {
      const minX = Math.floor(Math.min(...corners.map((c) => c.x)));
      const minY = Math.floor(Math.min(...corners.map((c) => c.y)));
      const maxX = Math.ceil(Math.max(...corners.map((c) => c.x)));
      const maxY = Math.ceil(Math.max(...corners.map((c) => c.y)));
      const boundWidth = maxX - minX;
      const boundHeight = maxY - minY;

      if (boundWidth > 0 && boundHeight > 0) {
        const tempCanvas = canvasPool.acquire(boundWidth, boundHeight);
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

        if (tempCtx) {
          tempCtx.clearRect(0, 0, boundWidth, boundHeight);

          const localGradient = tempCtx.createLinearGradient(
            startX - minX,
            startY - minY,
            endX - minX,
            endY - minY
          );

          if (colors.length > 0) {
            if (colors.length === 1) {
              localGradient.addColorStop(0, colors[0]);
              localGradient.addColorStop(1, colors[0]);
            } else if (brushSettings.gradientBands && brushSettings.gradientBands > 0) {
              const bandCount = Math.min(brushSettings.gradientBands, colors.length);
              for (let i = 0; i < bandCount; i += 1) {
                const colorIndex = Math.floor((i / Math.max(1, bandCount - 1)) * (colors.length - 1));
                const color = colors[colorIndex];
                const startPos = i / bandCount;
                const endPos = (i + 1) / bandCount;

                if (i === 0) {
                  localGradient.addColorStop(0, color);
                } else {
                  localGradient.addColorStop(startPos, color);
                }

                if (i === bandCount - 1) {
                  localGradient.addColorStop(1, color);
                } else {
                  localGradient.addColorStop(endPos - 0.001, color);
                }
              }
            } else {
              colors.forEach((color, index) => {
                const position = index / (colors.length - 1);
                localGradient.addColorStop(position, color);
              });
            }
          } else {
            localGradient.addColorStop(0, brushSettings.color);
            localGradient.addColorStop(1, brushSettings.color);
          }

          tempCtx.fillStyle = localGradient;
          tempCtx.fillRect(0, 0, boundWidth, boundHeight);

          const imageData = tempCtx.getImageData(0, 0, boundWidth, boundHeight);
          const numColors = brushSettings.gradientBands || brushSettings.colors || 2;
          const fillResolution = brushSettings.fillResolution || 1;
          const algorithm = brushSettings.ditherAlgorithm || 'sierra-lite';
          const patternStyle = brushSettings.patternStyle || 'dots';
          const paletteColors = spreadPaletteColors(
            colors.length > 0 ? colors : [brushSettings.color],
            brushSettings.ditherPaletteSpread
          );
          const ditheredData = fillResolution > 1
            ? applyDitheringWithFillResolution(
                imageData,
                numColors,
                fillResolution,
                algorithm,
                patternStyle,
                paletteColors
              )
            : applyDithering(imageData, numColors, algorithm, patternStyle, paletteColors);

          tempCtx.putImageData(ditheredData, 0, 0);

          ctx.save();
          ctx.imageSmoothingEnabled = !isPixelBrush;
          ctx.beginPath();
          drawPolygonPath(ctx, corners, false);
          ctx.closePath();
          ctx.clip();

          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(tempCanvas, minX, minY);

          ctx.restore();
          canvasPool.release(tempCanvas);
        }
      }
    }

    const risographIntensity = brushSettings.risographIntensity || 0;
    if (risographIntensity > 0 && !isPreview) {
      const pattern = getRisographPattern(ctx);

      if (pattern) {
        const effect = getRisographEffectSettings(risographIntensity, { isPixelBrush });
        if (effect.alpha > 0) {
          ctx.save();

          const minX = Math.floor(Math.min(...corners.map((c) => c.x)));
          const minY = Math.floor(Math.min(...corners.map((c) => c.y)));
          const maxX = Math.ceil(Math.max(...corners.map((c) => c.x)));
          const maxY = Math.ceil(Math.max(...corners.map((c) => c.y)));
          if ((maxX - minX) * (maxY - minY) < 16) {
            ctx.restore();
            return;
          }

          const seed = hashNumbers(minX, minY, maxX, maxY, risographIntensity);
          const rng = createSeededRng(seed);
          const misregXBase = (rng() - 0.5) * effect.jitter;
          const misregYBase = (rng() - 0.5) * effect.jitter;
          const misregX = isPixelBrush ? 0 : misregXBase;
          const misregY = isPixelBrush ? 0 : misregYBase;
          const rotation = isPixelBrush ? 0 : (rng() - 0.5) * 0.08;
          const scale = isPixelBrush ? 1 : 1 + (rng() - 0.5) * 0.04;
          const filter = isPixelBrush
            ? 'none'
            : getRisographFilter(brushSettings.color || '#000', brushSettings.risographColorShift ?? 3, rng);

          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          ctx.translate(misregX, misregY);
          ctx.translate(cx, cy);
          ctx.rotate(rotation);
          ctx.scale(scale, scale);
          ctx.translate(-cx, -cy);

          ctx.beginPath();
          drawPolygonPath(ctx, corners, isPixelBrush);
          ctx.closePath();
          ctx.clip();

          const regionWidth = maxX - minX;
          const regionHeight = maxY - minY;
          const drawPatternPass = (
            mask: HTMLCanvasElement | undefined,
            alpha: number,
            passFilter: string
          ) => {
            if (alpha <= 0) {
              return;
            }
            if (!mask) {
              setMultiplyIfUnlocked(ctx);
              ctx.fillStyle = pattern;
              ctx.globalAlpha = alpha;
              ctx.filter = passFilter;
              ctx.fillRect(minX, minY, regionWidth, regionHeight);
              return;
            }

            const temp = canvasPool.acquire(regionWidth, regionHeight);
            const tctx = temp.getContext('2d');
            if (!tctx) {
              canvasPool.release(temp);
              return;
            }

            tctx.setTransform(1, 0, 0, 1, 0, 0);
            tctx.clearRect(0, 0, regionWidth, regionHeight);
            tctx.filter = passFilter;
            tctx.globalAlpha = alpha;
            tctx.fillStyle = pattern;
            tctx.fillRect(0, 0, regionWidth, regionHeight);
            tctx.globalCompositeOperation = 'destination-in';
            tctx.drawImage(mask, 0, 0, regionWidth, regionHeight);

            ctx.filter = 'none';
            ctx.globalAlpha = 1;
            setMultiplyIfUnlocked(ctx);
            ctx.drawImage(temp, minX, minY, regionWidth, regionHeight);
            canvasPool.release(temp);
          };

          drawPatternPass(undefined, effect.alpha, 'none');
          const tintMask = createRisoTintMask(regionWidth, regionHeight, isPixelBrush, rng);
          const tintAlpha = Math.min(effect.alpha * 0.45, 0.5);
          drawPatternPass(tintMask, tintAlpha, filter);

          ctx.restore();
        }
      }
    }

    ctx.restore();
  });
};
