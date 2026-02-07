import type { BrushSettings } from '@/types';

import type { StrokeDitherRegionOptions } from './strokeDitherRegion';
import type { Rect } from './engineShared';

type ReusableCanvas2D = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };

type DitherRegionWithCurrentPressureArgs = {
  ctx: CanvasRenderingContext2D;
  region: { x: number; y: number; width: number; height: number };
  sampleCtx?: CanvasRenderingContext2D;
  options?: StrokeDitherRegionOptions;
  ditherRegionWithCurrentPressureUtil: (args: {
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
  }) => void;
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
};

export const ditherRegionWithCurrentPressure = ({
  ctx,
  region,
  sampleCtx,
  options,
  ditherRegionWithCurrentPressureUtil,
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
}: DitherRegionWithCurrentPressureArgs): void => {
  ditherRegionWithCurrentPressureUtil({
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
  });
};

type ApplyStrokeDitherArgs = {
  ctx: CanvasRenderingContext2D;
  bounds: Rect | null;
  sampleCtx?: CanvasRenderingContext2D;
  options?: {
    mergeExisting?: boolean;
    overridePressure?: number;
    overridePixelSize?: number;
    bgOffMode?: 'direct' | 'accumulate';
    bgOffComposite?: 'copy' | 'source-over';
    settingsOverride?: BrushSettings;
  };
  toolsBrushSettings: BrushSettings;
  shouldApplyStrokeDitherForSettings: (settings: BrushSettings) => boolean;
  normalizeRectForCanvas: (bounds: Rect | undefined, width: number, height: number) => Rect;
  ditherRegionWithCurrentPressure: (
    ctx: CanvasRenderingContext2D,
    region: { x: number; y: number; width: number; height: number },
    sampleCtx?: CanvasRenderingContext2D,
    options?: StrokeDitherRegionOptions
  ) => void;
};

export const applyStrokeDither = ({
  ctx,
  bounds,
  sampleCtx,
  options,
  toolsBrushSettings,
  shouldApplyStrokeDitherForSettings,
  normalizeRectForCanvas,
  ditherRegionWithCurrentPressure,
}: ApplyStrokeDitherArgs): void => {
  const settings = options?.settingsOverride ?? toolsBrushSettings;
  if (!shouldApplyStrokeDitherForSettings(settings) || !ctx || !bounds) {
    return;
  }
  const { width: canvasWidth = 0, height: canvasHeight = 0 } = ctx.canvas || {};
  const region = normalizeRectForCanvas(bounds, canvasWidth, canvasHeight);
  ditherRegionWithCurrentPressure(ctx, region, sampleCtx, options);
};
