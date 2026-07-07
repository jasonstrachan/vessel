import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type {
  ColorCycleLayerDirtyBatch,
  ColorCycleLayerDocumentRead,
} from '@/lib/colorCycle/document';
import type { GradientStop } from '@/lib/GradientPalette';
import { getMaskManager } from '@/layers/MaskManager';
import { debugLog, debugWarn } from '@/utils/debug';

import type {
  ColorCyclePresenterCommitParams,
  ColorCyclePresenterCompositeLayer,
  ColorCyclePresenterDirectRenderParams,
} from './colorCyclePresenter';
import type { LayerStrokeState, SerializedLayerColorCycleMeta } from './colorCycleCanvas2DTypes';

export type ColorCycleRenderCommitContext = {
  renderCompositeLayers(layers: ColorCyclePresenterCompositeLayer[], reason: string): boolean;
  cancelScheduledRender(): void;
  notifyFrameRendered(dirtyBatches: ColorCycleLayerDirtyBatch[]): void;
  clearDirtyLayers(): void;
  renderDirectToCanvas(params: ColorCyclePresenterDirectRenderParams): void;
  commitToLayer(params: ColorCyclePresenterCommitParams): void;
  isAnimating(): boolean;
  forEachAnimator(callback: (animator: ColorCycleAnimator, layerId: string) => void): void;
  getAnimator(layerId: string): ColorCycleAnimator | undefined;
  ensureAnimator(layerId: string): ColorCycleAnimator;
  getStrokeState(layerId: string): LayerStrokeState | undefined;
  getStrokeStateValues(): Iterable<LayerStrokeState>;
  getLayerDocumentRead(layerId: string): ColorCycleLayerDocumentRead | undefined;
  getLayerColorCycleMeta(layerId: string): SerializedLayerColorCycleMeta | null;
  applyDefBindingsForLayer(
    layerId: string,
    animator: ColorCycleAnimator,
    strokeData: LayerStrokeState | undefined,
    defs?: Array<{ id: number; hash: string; stops: GradientStop[] }>,
  ): void;
  paintHasContent(paint: Uint8Array | undefined, width: number, height: number): boolean;
  getCanvasWidth(): number;
  getCanvasHeight(): number;
  finalizeCurrentStroke(layerId?: string): void;
  isDrawing(): boolean;
};

export function renderColorCycleFrame(
  context: ColorCycleRenderCommitContext,
  _forceFullOpacity: boolean = false,
  dirtyBatches: ColorCycleLayerDirtyBatch[] = [],
): void {
  void _forceFullOpacity;
  const layers: ColorCyclePresenterCompositeLayer[] = [];
  context.forEachAnimator((animator, layerId) => {
    const strokeData = context.getStrokeState(layerId);
    if (!strokeData?.hasContent) {
      return;
    }

    layers.push({
      layerId,
      animator,
      documentRead: context.getLayerDocumentRead(layerId),
      tier: context.isAnimating() ? 'animated' : 'static',
      prepare: () => {
        const defs = context.getLayerColorCycleMeta(layerId)?.gradientDefStore as Array<{
          id: number;
          hash: string;
          stops: GradientStop[];
        }> | undefined;
        context.applyDefBindingsForLayer(layerId, animator, strokeData, defs);
      },
    });
  });

  const didRender = context.renderCompositeLayers(layers, 'ColorCycleBrushCanvas2D.render');
  if (!didRender) {
    context.cancelScheduledRender();
    context.notifyFrameRendered(dirtyBatches);
    return;
  }

  context.clearDirtyLayers();
  context.notifyFrameRendered(dirtyBatches);
}

export function renderColorCycleDirectToCanvas(
  context: ColorCycleRenderCommitContext,
  targetCanvas: HTMLCanvasElement,
  layerId: string,
): void {
  if (!targetCanvas) {
    debugWarn('raw-console', 'Target canvas is required for renderDirectToCanvas');
    return;
  }

  if (!layerId) {
    debugWarn('raw-console', 'Layer ID is required for renderDirectToCanvas');
    return;
  }

  let animator = context.getAnimator(layerId);
  if (!animator) {
    try {
      animator = context.ensureAnimator(layerId);
    } catch {
      return;
    }
  }
  if (!animator) {
    return;
  }

  const strokeData = context.getStrokeState(layerId);
  const ctx = targetCanvas.getContext('2d');
  if (!ctx) {
    debugWarn('raw-console', 'Failed to get 2D context from target canvas');
    return;
  }

  let hasRenderableContent = strokeData?.hasContent ?? false;
  if (!hasRenderableContent) {
    try {
      hasRenderableContent = context.paintHasContent(
        strokeData?.buffers.paint,
        context.getCanvasWidth(),
        context.getCanvasHeight(),
      );
    } catch {}
  }

  if (hasRenderableContent) {
    try {
      const defs = context.getLayerColorCycleMeta(layerId)?.gradientDefStore as Array<{
        id: number;
        hash: string;
        stops: GradientStop[];
      }> | undefined;
      context.applyDefBindingsForLayer(layerId, animator, strokeData, defs);
    } catch {}
  }

  context.renderDirectToCanvas({
    targetCanvas,
    ctx,
    layerId,
    animator,
    documentRead: hasRenderableContent ? context.getLayerDocumentRead(layerId) : undefined,
    hasRenderableContent,
    preserveExternalBase: Boolean(strokeData?.externalBase.hasExternalBase),
    applyMask: applyColorCycleMask,
  });
}

export function commitCurrentColorCycleStroke(
  context: ColorCycleRenderCommitContext,
  layerId: string,
): void {
  try {
    context.finalizeCurrentStroke(layerId);
    const animator = context.getAnimator(layerId);
    if (animator) {
      animator.forceRender();
    }
  } catch (error) {
    debugWarn('raw-console', '[ColorCycleBrush.commitCurrentStroke] Failed to finalize stroke:', error);
  }
}

export function commitColorCycleLayerToCanvas(
  context: ColorCycleRenderCommitContext,
  targetCanvas: HTMLCanvasElement,
  layerId: string,
  opacity: number = 1,
): void {
  if (!targetCanvas) {
    debugWarn('raw-console', '[ColorCycleBrush.commitToLayer] No target canvas provided');
    return;
  }
  if (!layerId) {
    debugWarn('raw-console', '[ColorCycleBrush.commitToLayer] No layerId provided');
    return;
  }

  let animator = context.getAnimator(layerId);
  if (!animator) {
    try {
      animator = context.ensureAnimator(layerId);
    } catch {
      return;
    }
  }

  const ctx = targetCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    debugWarn('raw-console', '[ColorCycleBrush.commitToLayer] Failed to acquire 2D context');
    return;
  }

  const strokeData = context.getStrokeState(layerId);
  logCommitDiagnostics(context, targetCanvas, layerId, animator, strokeData);
  context.commitToLayer({
    targetCanvas,
    ctx,
    layerId,
    animator,
    documentRead: context.getLayerDocumentRead(layerId),
    opacity,
    applyMask: applyColorCycleMask,
  });
}

export function hasColorCycleAnimatedContent(context: ColorCycleRenderCommitContext): boolean {
  for (const strokeData of context.getStrokeStateValues()) {
    if (strokeData?.hasContent) {
      return true;
    }
  }
  return false;
}

const applyColorCycleMask = (layerId: string, ctx: CanvasRenderingContext2D): void => {
  try {
    const maskManager = getMaskManager();
    maskManager.applyMaskToCanvas(layerId, ctx);
  } catch {}
};

const logCommitDiagnostics = (
  context: ColorCycleRenderCommitContext,
  targetCanvas: HTMLCanvasElement,
  layerId: string,
  animator: ColorCycleAnimator,
  strokeData: LayerStrokeState | undefined,
): void => {
  const shouldCommitLog =
    process.env.NODE_ENV !== 'production' &&
    typeof globalThis !== 'undefined' &&
    (globalThis as { __CC_STAMP_DEBUG?: boolean }).__CC_STAMP_DEBUG === true;
  if (!shouldCommitLog) {
    return;
  }

  try {
    const dimensions = animator.getDimensions();
    debugLog('raw-console', '[CC commit] animator surface', {
      width: dimensions.width,
      height: dimensions.height,
      hasWebGL: animator.hasWebGL?.() ?? false,
    });
  } catch {}

  try {
    const previewHasCtx = !!targetCanvas.getContext('2d');
    if (typeof window !== 'undefined') {
      const w = window as Window & { __ccDebug?: Record<string, unknown> };
      w.__ccDebug = {
        ...(w.__ccDebug ?? {}),
        commit: {
          previewCanvas: { w: targetCanvas.width, h: targetCanvas.height, hasCtx: previewHasCtx },
          animator: animator.getDimensions(),
          sampledAfterClear: false,
          isDrawing: context.isDrawing(),
          strokeData: {
            hasContent: strokeData?.hasContent ?? false,
          },
        },
      };
    }
    const animatorTransitions = sampleAnimatorTransitions(context, strokeData);
    const previewTransitions = sampleCanvasTransitions(targetCanvas);
    if (typeof window !== 'undefined') {
      const w = window as Window & { __ccDebug?: Record<string, unknown> };
      const commit = (w.__ccDebug as { commit?: Record<string, unknown> } | undefined)?.commit ?? {};
      w.__ccDebug = {
        ...(w.__ccDebug ?? {}),
        commit: {
          ...commit,
          transitions: { animatorTransitions, previewTransitions },
        },
      };
    }
    debugLog('raw-console', '[CC commit] transitions', { layerId, animatorTransitions, previewTransitions });
  } catch {}
};

const sampleCanvasTransitions = (canvas: HTMLCanvasElement): {
  transitions: number | null;
  reason: 'ok' | 'no_ctx' | 'zero_size' | 'exception';
  error?: string;
} => {
  try {
    const sampleCtx = canvas.getContext('2d', { willReadFrequently: true });
    if (!sampleCtx) return { transitions: null, reason: 'no_ctx' };
    const sampleW = Math.min(64, canvas.width);
    const sampleH = Math.min(64, canvas.height);
    if (sampleW <= 0 || sampleH <= 0) return { transitions: null, reason: 'zero_size' };
    const data = sampleCtx.getImageData(0, 0, sampleW, sampleH).data;
    let transitions = 0;
    for (let y = 0; y < sampleH; y += 1) {
      const row = y * sampleW * 4;
      for (let x = 1; x < sampleW; x += 1) {
        const idx = row + x * 4;
        const prev = idx - 4;
        if (data[idx] !== data[prev] || data[idx + 1] !== data[prev + 1] || data[idx + 2] !== data[prev + 2]) {
          transitions += 1;
        }
      }
    }
    return { transitions, reason: 'ok' };
  } catch (error) {
    return { transitions: null, reason: 'exception', error: String(error) };
  }
};

const sampleAnimatorTransitions = (
  context: ColorCycleRenderCommitContext,
  strokeData: LayerStrokeState | undefined,
): { transitions: number | null; reason: 'ok' | 'zero_size' | 'exception'; error?: string } => {
  try {
    const data = strokeData?.buffers.paint;
    const width = context.getCanvasWidth();
    const height = context.getCanvasHeight();
    if (!data || width <= 0 || height <= 0) {
      return { transitions: null, reason: 'zero_size' };
    }
    const sampleW = Math.min(64, width);
    const sampleH = Math.min(64, height);
    const stepX = Math.max(1, Math.floor(width / sampleW));
    const stepY = Math.max(1, Math.floor(height / sampleH));
    let transitions = 0;
    for (let y = 0; y < height; y += stepY) {
      const row = y * width;
      let prev = data[row];
      for (let x = stepX; x < width; x += stepX) {
        const idx = row + x;
        const value = data[idx];
        if (value !== prev) {
          transitions += 1;
        }
        prev = value;
      }
    }
    return { transitions, reason: 'ok' };
  } catch (error) {
    return { transitions: null, reason: 'exception', error: String(error) };
  }
};
