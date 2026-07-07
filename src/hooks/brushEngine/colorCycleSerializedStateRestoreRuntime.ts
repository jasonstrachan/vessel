import {
  clearColorCycleBrushStrokeStateForRestore,
  createColorCycleBrushDeserializeSettingsPatch,
  createColorCycleBrushFullStateRestorePlan,
  createColorCycleBrushRestoreBlockedClearAuditPlan,
  executeColorCycleBrushFullStateRestorePlan,
} from '@/lib/colorCycle/document';
import type { Layer } from '@/types';
import {
  logCCMutation,
  summarizeColorCycleLayer,
} from '@/utils/colorCycle/ccMutationAudit';

import type {
  AnimatorIndexSnapshot,
  ColorCycleBrushCanvasState,
  ColorCycleRuntimeMutationReason,
  LayerStrokeState,
  StrokeDataSnapshot,
} from './colorCycleCanvas2DTypes';
import type { CCBrushSettingsPatch } from './colorCycleBrushContracts';
import type { RestoreOpts } from './colorCycleCanvas2DUtils';

export type ColorCycleSerializedStateRestoreContext = {
  getCurrentStrokeCounter(): number;
  hasCanonicalPaintPayload(layerId: string): boolean;
  setHistoryRestore(isHistoryRestore: boolean): void;
  applySettings(settings: CCBrushSettingsPatch): void;
  applyLegacyStampDitherClears(clears: boolean): void;
  getLayer(layerId: string): Layer | undefined;
  getStrokeState(layerId: string): LayerStrokeState | undefined;
  brushStateHasPaintPayload(layerId: string, brushState: unknown): boolean;
  hasStrokeState(layerId: string): boolean;
  clearStrokeStateForRestore(layerId: string): void;
  clearAnimator(layerId: string): void;
  clearComposite(): void;
  applyLayerSnapshot(
    layerId: string,
    snapshot: StrokeDataSnapshot,
    animatorIndex: AnimatorIndexSnapshot | undefined,
    reason: ColorCycleRuntimeMutationReason,
  ): void;
  setHighestStrokeCounter(strokeCounter: number): void;
};

export function restoreColorCycleSerializedStateRuntime(
  context: ColorCycleSerializedStateRestoreContext,
  state: ColorCycleBrushCanvasState = {},
  opts: RestoreOpts = {},
): void {
  const asHistory = opts.mode === 'history' || opts.preservePaintBuffer === true;
  const plan = createColorCycleBrushFullStateRestorePlan({
    state,
    asHistory,
    currentStrokeCounter: context.getCurrentStrokeCounter(),
    isProduction: process.env.NODE_ENV === 'production',
    hasCanonicalPaintPayload: (layerId) => context.hasCanonicalPaintPayload(layerId),
  });
  context.setHistoryRestore(asHistory);
  try {
    executeColorCycleBrushFullStateRestorePlan({
      plan,
      applySettings: (restoreSettings) => {
        context.applySettings(createColorCycleBrushDeserializeSettingsPatch(
          restoreSettings,
        ) as CCBrushSettingsPatch);
      },
      applyLegacyStampDitherClears: (clears) => context.applyLegacyStampDitherClears(clears),
      logBlockedClear: (operation) => {
        const { layerId } = operation;
        const layer = context.getLayer(layerId);
        const blockedClearAudit = createColorCycleBrushRestoreBlockedClearAuditPlan({
          existingHasContent: context.getStrokeState(layerId)?.hasContent ?? null,
          brushStateHasPayload: context.brushStateHasPaintPayload(
            layerId,
            layer?.layerType === 'color-cycle' ? layer.colorCycleData?.brushState : undefined,
          ),
        });
        logCCMutation({
          event: 'cc-empty-live-buffer-write-blocked',
          layerId,
          reason: 'restoreFullState',
          severity: blockedClearAudit.severity,
          before: summarizeColorCycleLayer(layer),
          after: summarizeColorCycleLayer(layer),
          details: blockedClearAudit.details,
        });
      },
      clearLayer: (operation) => {
        const { layerId } = operation;
        if (context.hasStrokeState(layerId)) {
          context.clearStrokeStateForRestore(layerId);
        }
        context.clearAnimator(layerId);
      },
      clearComposite: () => context.clearComposite(),
      applyLayerSnapshot: (operation) => context.applyLayerSnapshot(
        operation.layerId,
        operation.snapshot as StrokeDataSnapshot,
        operation.animatorIndex as AnimatorIndexSnapshot | undefined,
        operation.reason,
      ),
      setHighestStrokeCounter: (strokeCounter) => {
        context.setHighestStrokeCounter(strokeCounter);
      },
      assertNoClear: (clearedDuringRestore) => {
        console.assert(!clearedDuringRestore, '[ColorCycleBrush] Cleared stroke data during history restore');
      },
    });
  } finally {
    context.setHistoryRestore(false);
  }
}

export function clearColorCycleStrokeStateForSerializedRestore(strokeState: LayerStrokeState): void {
  clearColorCycleBrushStrokeStateForRestore(strokeState);
}
