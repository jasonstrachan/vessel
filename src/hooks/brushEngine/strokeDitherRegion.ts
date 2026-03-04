import { parseColor } from './colorUtils';
import { applyDithering as applyDitheringImport, applyDitheringWithFillResolution } from './dithering';

import type { BrushSettings } from '@/types';

export type StrokeDitherRegionOptions = {
  mergeExisting?: boolean;
  overridePressure?: number;
  overridePixelSize?: number;
  bgOffMode?: 'direct' | 'accumulate';
  bgOffComposite?: 'copy' | 'source-over';
  settingsOverride?: BrushSettings;
};

type ReusableCanvas2D = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };

const promoteWholePixelCellsForDitherEdges = (imageData: ImageData, pixelSize: number): void => {
  const size = Math.max(1, Math.floor(pixelSize));
  if (size <= 1) {
    return;
  }

  const { data, width, height } = imageData;

  for (let by = 0; by < height; by += size) {
    const endY = Math.min(height, by + size);
    for (let bx = 0; bx < width; bx += size) {
      const endX = Math.min(width, bx + size);
      let bestA = 0;
      let bestR = 0;
      let bestG = 0;
      let bestB = 0;

      for (let y = by; y < endY; y += 1) {
        for (let x = bx; x < endX; x += 1) {
          const idx = (y * width + x) * 4;
          const alpha = data[idx + 3];
          if (alpha > bestA) {
            bestA = alpha;
            bestR = data[idx];
            bestG = data[idx + 1];
            bestB = data[idx + 2];
          }
        }
      }

      if (bestA === 0) {
        continue;
      }

      for (let y = by; y < endY; y += 1) {
        for (let x = bx; x < endX; x += 1) {
          const idx = (y * width + x) * 4;
          data[idx] = bestR;
          data[idx + 1] = bestG;
          data[idx + 2] = bestB;
          data[idx + 3] = bestA;
        }
      }
    }
  }
};

export const ditherRegionWithCurrentPressure = ({
  ctx,
  region,
  sampleCtx,
  options,
  toolsBrushSettings,
  strokeDitherPalette,
  transparentInk,
  computeStrokeDitherPaletteForSettings,
  pickTransparentInk,
  computePressureScaledResolution,
  getStrokeDitherPixelSize,
  applyLostEdgeToStrokeAlpha,
  ensureBgOffTemp,
  ensureBgOffHole,
  bgOffMaskImageRef,
  strokePhaseOriginRef,
  DD,
}: {
  ctx: CanvasRenderingContext2D;
  region: { x: number; y: number; width: number; height: number };
  sampleCtx?: CanvasRenderingContext2D;
  options?: StrokeDitherRegionOptions;
  toolsBrushSettings: BrushSettings;
  strokeDitherPalette: string[];
  transparentInk: [number, number, number];
  computeStrokeDitherPaletteForSettings: (settings: BrushSettings) => string[];
  pickTransparentInk: (palette: string[]) => [number, number, number];
  computePressureScaledResolution: (pressure: number) => number;
  getStrokeDitherPixelSize: () => number;
  applyLostEdgeToStrokeAlpha: (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    lostEdgePercent?: number
  ) => void;
  ensureBgOffTemp: (width: number, height: number) => ReusableCanvas2D | null;
  ensureBgOffHole: (width: number, height: number) => ReusableCanvas2D | null;
  bgOffMaskImageRef: { current: ImageData | null };
  strokePhaseOriginRef: { current: { x: number; y: number } | null };
  DD: (step: string, obj: Record<string, unknown>) => void;
}): void => {
  const overridePressure = options?.overridePressure;
  const overridePixelSize = options?.overridePixelSize;
  const settings = options?.settingsOverride ?? toolsBrushSettings;
  const palette = options?.settingsOverride
    ? computeStrokeDitherPaletteForSettings(settings)
    : strokeDitherPalette;
  const transparent = options?.settingsOverride
    ? pickTransparentInk(palette)
    : transparentInk;

  const fillBackground = settings.ditherBackgroundFill !== false;
  const pressureMode = !!settings.pressureLinkedFillResolution || overridePressure != null || overridePixelSize != null;
  let bgOffMode = options?.bgOffMode ?? 'accumulate';
  let bgOffComposite = options?.bgOffComposite ?? 'source-over';

  if (!fillBackground && pressureMode && options?.bgOffMode == null) {
    bgOffMode = 'direct';
    bgOffComposite = 'copy';
  }
  const [bgR, bgG, bgB] = (() => {
    const candidate =
      palette[1] ??
      palette[0] ??
      settings.color ??
      '#000';
    const [r, g, b] = parseColor(candidate);
    return [r, g, b] as [number, number, number];
  })();
  const [offR, offG, offB] = transparent;

  const { x, y, width, height } = region;
  if (width <= 0 || height <= 0) return;

  let src: ImageData;
  try {
    const sourceCtx = sampleCtx ?? ctx;
    src = sourceCtx.getImageData(x, y, width, height);
  } catch (err) {
    console.warn('[Dither] Failed to sample region for pressure dither:', err);
    return;
  }

  const algorithm = settings.ditherAlgorithm || 'sierra-lite';
  const patternStyle = settings.patternStyle || 'dots';
  const baseFillRes = Math.max(1, Math.round(settings.fillResolution || 1));

  const resolvedOverridePixelSize = overridePixelSize != null
    ? Math.max(1, Math.round(overridePixelSize))
    : null;

  const pressureFillRes = resolvedOverridePixelSize ?? Math.max(
    1,
    overridePressure != null
      ? computePressureScaledResolution(Math.max(0, Math.min(1, overridePressure)))
      : getStrokeDitherPixelSize() | 0
  );

  const pixelSize = resolvedOverridePixelSize
    ?? (pressureMode ? pressureFillRes : baseFillRes);

  DD('pixel-size', {
    overridePixelSize,
    resolvedOverridePixelSize,
    overridePressure,
    settingsFillRes: toolsBrushSettings.fillResolution,
    pressureLinkedFillResolution: toolsBrushSettings.pressureLinkedFillResolution,
    baseFillRes,
    pressureFillRes,
    pixelSizeBeforeClamp: pixelSize
  });

  DD('region-enter', {
    fillBackground,
    algorithm,
    patternStyle,
    region: { x, y, width, height },
    pixelSize
  });

  if (settings.lostEdge && settings.lostEdge > 0) {
    applyLostEdgeToStrokeAlpha(
      src.data,
      width,
      height,
      settings.lostEdge
    );
  }

  if (settings.pxlEdge && pixelSize > 1) {
    promoteWholePixelCellsForDitherEdges(src, pixelSize);
  }

  const phaseOffset = !fillBackground
    ? (strokePhaseOriginRef.current ?? { x: 0, y: 0 })
    : undefined;

  const dithered = pixelSize > 1
    ? applyDitheringWithFillResolution(
        src,
        palette.length,
        pixelSize,
        algorithm,
        patternStyle,
        palette,
        phaseOffset
      )
    : applyDitheringImport(
        src,
        palette.length,
        algorithm,
        patternStyle,
        palette,
        phaseOffset
      );

  const data = dithered.data;
  const srcData = src.data;
  const canvasW = ctx.canvas?.width ?? 0;
  const canvasH = ctx.canvas?.height ?? 0;

  const isOffColor = (idx: number) =>
    data[idx] === offR &&
    data[idx + 1] === offG &&
    data[idx + 2] === offB;

  if (fillBackground) {
    for (let i = 0; i < data.length; i += 4) {
      data[i + 3] = srcData[i + 3];
    }
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha === 0 && srcData[i + 3] !== 0) {
        data[i] = bgR;
        data[i + 1] = bgG;
        data[i + 2] = bgB;
        data[i + 3] = srcData[i + 3];
      }
    }
  } else {
    const temp = ensureBgOffTemp(width, height);
    const hole = bgOffMode === 'accumulate' ? ensureBgOffHole(canvasW, canvasH) : null;
    if (!temp || (bgOffMode === 'accumulate' && !hole)) {
      ctx.putImageData(dithered, x, y);
      return;
    }

    let maskImage = bgOffMaskImageRef.current;
    if (!maskImage || maskImage.width !== width || maskImage.height !== height) {
      maskImage = new ImageData(width, height);
      bgOffMaskImageRef.current = maskImage;
    }
    const maskData = maskImage.data;

    for (let i = 0; i < data.length; i += 4) {
      const srcA = srcData[i + 3];
      if (srcA === 0) {
        data[i + 3] = 0;
        maskData[i + 3] = 0;
      } else {
        const off = isOffColor(i);
        if (off) {
          data[i + 3] = 0;
          maskData[i + 3] = srcA;
        } else {
          data[i + 3] = srcA;
          maskData[i + 3] = 0;
        }
      }

      maskData[i] = 0;
      maskData[i + 1] = 0;
      maskData[i + 2] = 0;
    }

    temp.ctx.setTransform(1, 0, 0, 1, 0, 0);
    temp.ctx.clearRect(0, 0, width, height);
    temp.ctx.putImageData(maskImage, 0, 0);

    if (bgOffMode === 'accumulate' && hole) {
      hole.ctx.save();
      hole.ctx.globalCompositeOperation = 'source-over';
      hole.ctx.drawImage(temp.canvas, x, y);
      hole.ctx.restore();
    }

    temp.ctx.setTransform(1, 0, 0, 1, 0, 0);
    temp.ctx.clearRect(0, 0, width, height);
    temp.ctx.putImageData(dithered, 0, 0);

    ctx.save();
    ctx.globalCompositeOperation = bgOffMode === 'direct' ? bgOffComposite : 'source-over';
    ctx.drawImage(temp.canvas, x, y);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    if (bgOffMode === 'accumulate' && hole) {
      ctx.drawImage(hole.canvas, x, y, width, height, x, y, width, height);
    } else {
      temp.ctx.setTransform(1, 0, 0, 1, 0, 0);
      temp.ctx.clearRect(0, 0, width, height);
      temp.ctx.putImageData(maskImage, 0, 0);
      ctx.drawImage(temp.canvas, x, y);
    }
    ctx.restore();
    return;
  }

  DD('pixel-size-final', {
    finalPixelSize: pixelSize
  });

  const previousSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  try {
    ctx.putImageData(dithered, x, y);
  } catch (err) {
    console.warn('[Dither] Failed to write dithered region:', err);
  } finally {
    ctx.imageSmoothingEnabled = previousSmoothing;
  }
};

export const __TESTING__ = {
  promoteWholePixelCellsForDitherEdges,
};
