import { type BrushSettings } from '@/types';
import { debugWarn } from '@/utils/debug';
import type { ColorCycleLayerDocumentRead } from '@/lib/colorCycle/document';

import type { ColorCycleSurfaceBrush, ColorCycleSurfaceSource } from './colorCycleSurface';

export type ColorCycleRenderBrush = ColorCycleSurfaceBrush & {
  renderDirectToCanvas: (canvas: HTMLCanvasElement, layerId: string) => void;
};

type RenderColorCycleArgs = {
  ctx: CanvasRenderingContext2D;
  applyOpacity?: boolean;
  withOverlay?: boolean;
  activeLayerId: string | null;
  getActiveLayerColorCycleBrush: () => ColorCycleRenderBrush | null;
  isFgPending: (layerId: string) => boolean;
  refreshLayerCCSurface: (brush: ColorCycleSurfaceSource, layerId: string) => HTMLCanvasElement | null;
  ensureCanvasPixelSize: (canvas: HTMLCanvasElement) => void;
  bindBrushToCanvas: (
    brush: ColorCycleSurfaceBrush | null | undefined,
    canvas: HTMLCanvasElement | null | undefined,
  ) => void;
  requestGradientApply: (layerId: string, reason: string) => void;
  flushGradientApply: (layerId: string) => void;
  brushSettings: Pick<BrushSettings, 'opacity' | 'blendMode'>;
  activeLayerTransparencyLock: boolean;
  renderCCWithBlendAndLock: (
    ctx: CanvasRenderingContext2D,
    layerCanvas: HTMLCanvasElement,
    blendMode: GlobalCompositeOperation,
  ) => void;
  applyColorCycleRisographOverlay: (
    ctx: CanvasRenderingContext2D,
    sourceCanvas: HTMLCanvasElement | OffscreenCanvas,
    outputOpacity: number,
  ) => void;
};

export const renderColorCycleToContext = ({
  ctx,
  applyOpacity = true,
  withOverlay = true,
  activeLayerId,
  getActiveLayerColorCycleBrush,
  isFgPending,
  refreshLayerCCSurface,
  ensureCanvasPixelSize,
  bindBrushToCanvas,
  requestGradientApply,
  flushGradientApply,
  brushSettings,
  activeLayerTransparencyLock,
  renderCCWithBlendAndLock,
  applyColorCycleRisographOverlay,
}: RenderColorCycleArgs): void => {
  const colorCycleBrush = getActiveLayerColorCycleBrush();
  if (!colorCycleBrush || !activeLayerId) {
    return;
  }
  if (isFgPending(activeLayerId)) {
    return;
  }

  const layerCanvas = refreshLayerCCSurface(colorCycleBrush, activeLayerId);
  if (!layerCanvas) {
    return;
  }

  ensureCanvasPixelSize(layerCanvas);

  try {
    bindBrushToCanvas(colorCycleBrush, layerCanvas);
    requestGradientApply(activeLayerId, 'render-color-cycle');
    flushGradientApply(activeLayerId);
    colorCycleBrush.renderDirectToCanvas(layerCanvas, activeLayerId);
  } catch (error) {
    debugWarn('raw-console', '[ColorCycle] Failed to render to layer canvas:', error);
    return;
  }

  if (ctx.canvas === layerCanvas) {
    return;
  }

  const previousComposite = ctx.globalCompositeOperation;
  const previousAlpha = ctx.globalAlpha;
  const drawOpacity = applyOpacity ? (brushSettings.opacity ?? 1) : 1;

  try {
    const blendMode = (brushSettings.blendMode || 'source-over') as GlobalCompositeOperation;
    ctx.globalAlpha = drawOpacity;

    if (activeLayerTransparencyLock) {
      renderCCWithBlendAndLock(ctx, layerCanvas, blendMode);
    } else {
      ctx.globalCompositeOperation = blendMode;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(layerCanvas, 0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    recordColorCycleRenderPreviewDiagnostics(ctx, layerCanvas, colorCycleBrush, activeLayerId);

    if (withOverlay) {
      applyColorCycleRisographOverlay(ctx, layerCanvas, drawOpacity);
    }
  } finally {
    ctx.globalCompositeOperation = previousComposite;
    ctx.globalAlpha = previousAlpha;
  }
};

const recordColorCycleRenderPreviewDiagnostics = (
  ctx: CanvasRenderingContext2D,
  layerCanvas: HTMLCanvasElement,
  colorCycleBrush: ColorCycleRenderBrush,
  activeLayerId: string,
): void => {
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  try {
    const srcCanvas = layerCanvas;
    const previewCanvas = ctx.canvas as HTMLCanvasElement;
    const srcHasCtx = !!srcCanvas.getContext('2d');
    const previewHasCtx = !!previewCanvas.getContext('2d');
    const brushDebug = colorCycleBrush as unknown as Record<string, unknown>;
    const isDrawing = typeof brushDebug.isDrawing === 'boolean' ? brushDebug.isDrawing : null;
    const strokeData = readStrokeDebugData(brushDebug, activeLayerId);

    if (typeof window !== 'undefined') {
      const w = window as Window & { __ccDebug?: Record<string, unknown> };
      w.__ccDebug = {
        ...(w.__ccDebug ?? {}),
        preview: {
          previewCanvas: { w: previewCanvas.width, h: previewCanvas.height, hasCtx: previewHasCtx },
          srcCanvas: { w: srcCanvas.width, h: srcCanvas.height, hasCtx: srcHasCtx },
          sameCanvas: srcCanvas === previewCanvas,
          sampledAfterClear: false,
          isDrawing,
          strokeData,
        },
      };
    }

    const srcTransitions = sampleCanvasTransitions(srcCanvas);
    const previewTransitions = sampleCanvasTransitions(previewCanvas);
    if (typeof window !== 'undefined') {
      const w = window as Window & { __ccDebug?: Record<string, unknown> };
      const preview = (w.__ccDebug as { preview?: Record<string, unknown> } | undefined)?.preview ?? {};
      w.__ccDebug = {
        ...(w.__ccDebug ?? {}),
        preview: {
          ...preview,
          transitions: { srcTransitions, previewTransitions },
        },
      };
    }
  } catch {}
};

const readStrokeDebugData = (
  brushDebug: Record<string, unknown>,
  activeLayerId: string,
): { hasContent: boolean | null; hasExternalBase: boolean | null } => {
  try {
    const getColorCycleLayerDocument = brushDebug.getColorCycleLayerDocument;
    if (typeof getColorCycleLayerDocument !== 'function') {
      return { hasContent: null, hasExternalBase: null };
    }
    const document = (getColorCycleLayerDocument as (
      layerId: string
    ) => { read(): ColorCycleLayerDocumentRead } | null | undefined)(activeLayerId);
    const documentRead = document?.read();
    const hasContent = typeof documentRead?.snapshot.hasContent === 'boolean'
      ? documentRead.snapshot.hasContent
      : null;
    return { hasContent, hasExternalBase: null };
  } catch {
    return { hasContent: null, hasExternalBase: null };
  }
};

const sampleCanvasTransitions = (canvas: HTMLCanvasElement): number | null => {
  const w = Math.min(16, canvas.width);
  const h = Math.min(16, canvas.height);
  if (w <= 1 || h <= 0) {
    return null;
  }
  const sampleCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!sampleCtx) {
    return null;
  }

  const data = sampleCtx.getImageData(0, 0, w, h).data;
  let transitions = 0;
  for (let y = 0; y < h; y += 1) {
    const row = y * w * 4;
    for (let x = 1; x < w; x += 1) {
      const idx = row + x * 4;
      const prev = idx - 4;
      if (
        data[idx] !== data[prev] ||
        data[idx + 1] !== data[prev + 1] ||
        data[idx + 2] !== data[prev + 2]
      ) {
        transitions += 1;
      }
    }
  }
  return transitions;
};
