import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { GradientStop } from '@/lib/GradientPalette';
import type { GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';
import { bindColorCycleCommittedGradientDefToSlot } from '@/lib/colorCycle/document';

import {
  ColorCycleDefPaletteCacheStore,
  type DefPaletteCache,
  type DefPaletteEntry,
} from './colorCycleDefPaletteCache';
import type { LayerStrokeState } from './colorCycleCanvas2DTypes';

type DefPaletteAnimator = ColorCycleAnimator & {
  setDefPaletteCache?: (cache?: {
    palettesById: Map<number, Uint32Array>;
    rgbaById: Map<number, Uint8ClampedArray | Uint8Array>;
    signaturesById: Map<number, string>;
  } | null) => void;
};

export class ColorCycleDefBindingRuntime {
  private readonly cacheStore = new ColorCycleDefPaletteCacheStore();

  getLastApplied(layerId: string): DefPaletteCache | null {
    return this.cacheStore.getLastApplied(layerId);
  }

  applyForLayer(params: {
    layerId: string;
    animator: ColorCycleAnimator;
    strokeData: LayerStrokeState | undefined;
    defs: Array<{
      id: number;
      hash: string;
      stops: GradientStop[];
      seamProfile?: GradientSeamProfile;
    }> | undefined;
    builtFromVersion: number | null;
    forceDefDirty?: boolean;
  }): void {
    const animator = params.animator as DefPaletteAnimator;
    if (typeof animator.setDefIdData === 'function') {
      animator.setDefIdData(
        params.strokeData?.buffers.def,
        params.forceDefDirty ? { forceDirty: true } : undefined,
      );
    }

    const cache = this.cacheStore.get(
      params.layerId,
      params.defs as DefPaletteEntry[] | undefined,
      params.builtFromVersion,
    );
    const lastAppliedCache = this.cacheStore.getLastApplied(params.layerId);
    if (typeof animator.setDefPaletteCache !== 'function') {
      return;
    }

    if (cache && cache !== lastAppliedCache) {
      animator.setDefPaletteCache(cache);
      this.cacheStore.setLastApplied(params.layerId, cache);
    } else if (!cache && lastAppliedCache !== null) {
      animator.setDefPaletteCache(null);
      this.cacheStore.setLastApplied(params.layerId, null);
    }
  }

  clear(): void {
    this.cacheStore.clear();
  }
}

export type ColorCycleGradientDefSlotBindingContext = {
  ensureStrokeState(layerId: string): LayerStrokeState;
  getCanvasWidth(): number;
  getCanvasHeight(): number;
  getAnimator(layerId: string): ColorCycleAnimator;
  getLayerGradientDefs(layerId: string): Array<{
    id: number;
    hash: string;
    stops: GradientStop[];
    seamProfile?: GradientSeamProfile;
  }> | undefined;
  applyDefBindingsForLayer(
    layerId: string,
    animator: ColorCycleAnimator,
    strokeData: LayerStrokeState,
    defs: Array<{
      id: number;
      hash: string;
      stops: GradientStop[];
      seamProfile?: GradientSeamProfile;
    }> | undefined,
    options: { forceDefDirty: boolean },
  ): void;
  snapshotFromBuffers(strokeData: LayerStrokeState): void;
  flowSlotMask: number;
};

export function bindColorCycleGradientDefIdToSlot(
  context: ColorCycleGradientDefSlotBindingContext,
  layerId: string,
  defId: number,
  slot: number,
  bbox?: {
    minX: number;
    minY: number;
    width: number;
    height: number;
  },
  previewSlot?: number | null,
): void {
  const strokeData = context.ensureStrokeState(layerId);
  const bindingResult = bindColorCycleCommittedGradientDefToSlot({
    buffers: strokeData.buffers,
    canvasWidth: context.getCanvasWidth(),
    canvasHeight: context.getCanvasHeight(),
    defId,
    slot,
    flowSlotMask: context.flowSlotMask,
    bbox,
    previewSlot,
    trackPreviewLeak: process.env.NODE_ENV !== 'production',
  });

  if (process.env.NODE_ENV !== 'production' && bindingResult.effectivePreviewSlot !== null) {
    console.assert(bindingResult.leftoverPreview === 0, '[CC] preview slot leaked into committed layer state', {
      layerId,
      leftover: bindingResult.leftoverPreview,
      previewSlot: bindingResult.effectivePreviewSlot,
      committedSlot: bindingResult.committedSlot,
    });
  }

  try {
    const animator = context.getAnimator(layerId);
    context.applyDefBindingsForLayer(
      layerId,
      animator,
      strokeData,
      context.getLayerGradientDefs(layerId),
      { forceDefDirty: true },
    );
  } catch {}

  context.snapshotFromBuffers(strokeData);
}
