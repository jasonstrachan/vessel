import {
  createColorCycleBrushSerializeSettings,
  serializeColorCycleBrushState,
  type ColorCycleBrushPersistenceAnimator,
  type ColorCycleBrushPersistenceLayerMeta,
  type ColorCycleBrushSerializeSettingsInput,
  type ColorCycleBrushSerializedState,
  type ColorCycleLayerDocumentRead,
} from '@/lib/colorCycle/document';

import type {
  ColorCycleBrushCanvasSerialized,
  LayerStrokeState,
} from './colorCycleCanvas2DTypes';

export type ColorCycleSerializedStateReadContext = {
  getAnimators(): Map<string, ColorCycleBrushPersistenceAnimator>;
  getStrokeState(layerId: string): LayerStrokeState | undefined;
  getDocumentRead(layerId: string): ColorCycleLayerDocumentRead | undefined;
  ensureStrokeSnapshot(strokeState: LayerStrokeState): void;
  hasPaintContent(paintBuffer: ArrayBuffer | undefined): boolean;
  hasStrokeContent(strokeState: LayerStrokeState): boolean;
  getLayerMeta(layerId: string): ColorCycleBrushPersistenceLayerMeta | null;
  getFallbackStrokeCounter(): number;
  getSerializeSettings(): ColorCycleBrushSerializeSettingsInput;
};

export function readColorCycleSerializedStateRuntime(
  context: ColorCycleSerializedStateReadContext,
): ColorCycleBrushCanvasSerialized {
  return serializeColorCycleBrushState({
    animators: context.getAnimators(),
    getStrokeState: (layerId) => context.getStrokeState(layerId),
    getDocumentRead: (layerId) => context.getDocumentRead(layerId),
    ensureStrokeSnapshot: (strokeState) => {
      context.ensureStrokeSnapshot(strokeState as LayerStrokeState);
    },
    hasPaintContent: (paintBuffer) => context.hasPaintContent(paintBuffer),
    hasStrokeContent: (strokeState) => context.hasStrokeContent(strokeState as LayerStrokeState),
    getLayerMeta: (layerId) => context.getLayerMeta(layerId),
    getFallbackStrokeCounter: () => context.getFallbackStrokeCounter(),
    settings: createColorCycleBrushSerializeSettings(context.getSerializeSettings()),
  }) as ColorCycleBrushSerializedState as ColorCycleBrushCanvasSerialized;
}
