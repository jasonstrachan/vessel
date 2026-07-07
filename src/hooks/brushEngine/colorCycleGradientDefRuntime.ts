import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { GradientStop } from '@/lib/GradientPalette';
import type { GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';
import type { CustomBrushColorCycleData } from '@/types';
import { ensureGradientDefForStops } from '@/utils/colorCycleGradientDefs';

import type { LayerStrokeState, SerializedLayerColorCycleMeta } from './colorCycleCanvas2DTypes';

export type CapturedStampGradientBinding = {
  slot: number;
  defId: number;
};

type GradientDefStoreEntry = {
  id: number;
  hash?: string;
  stops?: GradientStop[];
  seamProfile?: GradientSeamProfile;
  slot?: number;
};

export type ColorCycleCapturedStampGradientContext = {
  setGradientSlotStops(
    layerId: string,
    slot: number,
    stops: GradientStop[],
    seamProfile?: GradientSeamProfile,
  ): void;
  setLayerMeta(layerId: string, meta: SerializedLayerColorCycleMeta | null): void;
  getLayerColorCycleMeta(layerId: string): SerializedLayerColorCycleMeta | null;
};

export function resolveColorCycleGradientDefIdForSlot(
  context: Pick<ColorCycleCapturedStampGradientContext, 'getLayerColorCycleMeta'>,
  layerId: string,
  slot: number,
): number | null {
  const defs = context.getLayerColorCycleMeta(layerId)?.gradientDefStore as
    | GradientDefStoreEntry[]
    | undefined;
  const matched = defs?.find((entry) => entry.slot === slot);
  return typeof matched?.id === 'number' && Number.isFinite(matched.id)
    ? matched.id
    : null;
}

export function resolveColorCycleCapturedStampGradientBinding(
  context: ColorCycleCapturedStampGradientContext,
  layerId: string,
  colorCycle: CustomBrushColorCycleData | undefined,
): CapturedStampGradientBinding | null {
  if (
    colorCycle?.schemaVersion !== 2 ||
    colorCycle.mode !== 'captured-data' ||
    !Array.isArray(colorCycle.gradient) ||
    colorCycle.gradient.length === 0
  ) {
    return null;
  }

  const stops = colorCycle.gradient.map((stop) => ({ ...stop }));
  const ensured = ensureGradientDefForStops({
    layerId,
    kind: 'linear',
    stops,
    source: 'sampled',
    speedCps: colorCycle.speed,
    seamProfile: 'hard',
    updateOptions: { skipColorCycleSync: true },
  });
  if (!ensured) {
    return null;
  }

  context.setGradientSlotStops(layerId, ensured.slot, stops, 'hard');
  context.setLayerMeta(layerId, context.getLayerColorCycleMeta(layerId));
  return {
    slot: ensured.slot,
    defId: ensured.def.id,
  };
}

export type ColorCycleGradientDefSyncContext = {
  getActiveLayerId(): string | null;
  getAnimator(layerId: string): ColorCycleAnimator | undefined;
  getStrokeState(layerId: string): LayerStrokeState | undefined;
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
  ): void;
  markPresenterLayerDirty(layerId: string): void;
  render(force?: boolean): void;
};

export function syncColorCycleGradientDefRuntime(
  context: ColorCycleGradientDefSyncContext,
  layerId: string,
): void {
  const id = layerId || context.getActiveLayerId() || 'default';
  const animator = context.getAnimator(id);
  const strokeData = context.getStrokeState(id);
  if (!animator || !strokeData) {
    return;
  }

  try {
    context.applyDefBindingsForLayer(
      id,
      animator,
      strokeData,
      context.getLayerGradientDefs(id),
    );
    animator.forceRender();
    context.markPresenterLayerDirty(id);
    context.render(false);
  } catch {}
}
