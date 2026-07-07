import { getAppStoreState } from '@/stores/appStoreAccess';
import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { GradientStop } from '@/lib/GradientPalette';
import { FLOW_SLOT_MASK } from '@/lib/colorCycle/flowEncoding';
import type { GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';
import { resolveLayerColorCycleBaseSpeedFromLayer } from '@/utils/colorCycleLayerSpeed';
import {
  encodeColorCycleSpeedByte,
  sanitizeBrushColorCycleSpeed,
} from '@/utils/colorCycleSpeed';

import type {
  AnimatorIndexSnapshot,
  ColorCycleRuntimeMutationReason,
  LayerStrokeState,
  SerializedLayerColorCycleMeta,
  StrokeDataSnapshot,
} from './colorCycleCanvas2DTypes';
import {
  bindColorCycleRuntimeLayerStrokeBuffersToAnimator,
  createColorCycleRuntimeLayerStrokeState,
  snapshotColorCycleRuntimeLayerStrokeStateFromBuffers,
  type ColorCycleLayerDocumentRuntimeContext,
} from './colorCycleLayerDocumentRuntime';
import {
  applyColorCycleLayerSnapshotRuntime,
  type ColorCycleLayerSnapshotApplyContext,
} from './colorCycleLayerSnapshotApplyRuntime';
import { resolveColorCycleFlowByte } from './colorCycleStrokeTimingRuntime';

export type ColorCycleLayerSnapshotApplyApiRuntimeDeps = {
  getCanvasWidth(): number;
  getCanvasHeight(): number;
  getLayerDocumentRuntimeContext(): ColorCycleLayerDocumentRuntimeContext;
  getExistingStrokeState(layerId: string): LayerStrokeState | undefined;
  layerHasCanonicalColorCyclePaintPayload(layerId: string): boolean;
  brushStateHasColorCyclePaintPayload(brushState: unknown, layerId?: string): boolean;
  ensureFullResolution(layerId: string): ColorCycleAnimator;
  captureAuditSnapshot: ColorCycleLayerSnapshotApplyContext['captureAuditSnapshot'];
  getLayerMeta(layerId: string): SerializedLayerColorCycleMeta | null;
  getFlowMode(): ReturnType<ColorCycleLayerSnapshotApplyContext['getFallbackAnimationPlanOptions']>['brushFlowMode'];
  setGradientSlotStops(
    layerId: string,
    slot: number,
    stops: GradientStop[],
    seamProfile?: GradientSeamProfile,
  ): void;
  setActiveGradientSlot(layerId: string, slot: number): void;
  publishStrokeState: ColorCycleLayerSnapshotApplyContext['publishStrokeState'];
  recordClearAudit: ColorCycleLayerSnapshotApplyContext['recordClearAudit'];
  applyDefBindingsForLayer(
    layerId: string,
    animator: ColorCycleAnimator,
    strokeState: LayerStrokeState,
    defs: Array<{ id: number; hash: string; stops: GradientStop[]; seamProfile?: GradientSeamProfile }> | undefined,
  ): void;
  markLayerDirty(layerId: string): void;
};

export class ColorCycleLayerSnapshotApplyApiRuntime {
  constructor(
    private readonly deps: ColorCycleLayerSnapshotApplyApiRuntimeDeps,
  ) {}

  readonly apply = (
    layerId: string,
    snapshot: StrokeDataSnapshot,
    animatorIndex?: AnimatorIndexSnapshot,
    reason: ColorCycleRuntimeMutationReason = 'snapshot-apply',
    options?: { suppressClearAudit?: boolean },
  ): void => {
    applyColorCycleLayerSnapshotRuntime(
      this.getContext(),
      layerId,
      snapshot,
      animatorIndex,
      reason,
      options,
    );
  };

  private getContext(): ColorCycleLayerSnapshotApplyContext {
    return {
      canvasWidth: this.deps.getCanvasWidth(),
      canvasHeight: this.deps.getCanvasHeight(),
      flowSlotMask: FLOW_SLOT_MASK,
      getLayer: (layerId) => getAppStoreState().layers.find((candidate) => candidate.id === layerId),
      getExistingStrokeState: (layerId) => this.deps.getExistingStrokeState(layerId),
      hasCanonicalPaintPayload: (layerId) => this.deps.layerHasCanonicalColorCyclePaintPayload(layerId),
      brushStateHasPaintPayload: (layerId) => {
        const layer = getAppStoreState().layers.find((candidate) => candidate.id === layerId);
        return this.deps.brushStateHasColorCyclePaintPayload(
          layer?.layerType === 'color-cycle' ? layer.colorCycleData?.brushState : undefined,
          layerId,
        );
      },
      ensureAnimator: (layerId) => this.deps.ensureFullResolution(layerId),
      resizeAnimator: (animator, width, height) => animator.resize(width, height),
      createStrokeState: (options) => createColorCycleRuntimeLayerStrokeState(
        this.deps.getLayerDocumentRuntimeContext(),
        options,
      ),
      captureAuditSnapshot: (layerId, strokeState) => this.deps.captureAuditSnapshot(layerId, strokeState),
      getFallbackAnimationPlanOptions: (layerId) => {
        const state = getAppStoreState();
        const layer = state.layers.find((candidate) => candidate.id === layerId);
        return {
          layerBaseSpeed: resolveLayerColorCycleBaseSpeedFromLayer(layer),
          toolSpeed: state.tools?.brushSettings?.colorCycleSpeed,
          layerFlowMode: layer?.colorCycleData?.flowMode,
          brushFlowMode: this.deps.getFlowMode(),
        };
      },
      encodeFallbackSpeedByte: (speed) => encodeColorCycleSpeedByte(sanitizeBrushColorCycleSpeed(speed)),
      encodeFallbackFlowByte: (flowMode) => resolveColorCycleFlowByte(flowMode),
      applySlotPalette: (layerId, slot, stops, seamProfile) => {
        this.deps.setGradientSlotStops(layerId, slot, stops, seamProfile);
      },
      applyActiveGradientSlot: (layerId, slot) => this.deps.setActiveGradientSlot(layerId, slot),
      publishStrokeState: (layerId, strokeState, publish) => {
        this.deps.publishStrokeState(layerId, strokeState, publish);
      },
      recordClearAudit: (operation) => {
        this.deps.recordClearAudit(operation);
      },
      setIndexBuffers: (animator, result) => animator?.setIndexBufferFromArray(
        result.uploadPaint,
        result.uploadGradientId,
        result.uploadSpeed,
        result.uploadFlow,
        result.uploadPhase,
      ),
      bindStrokeBuffersToAnimator: (strokeState, animator) => {
        if (animator) {
          bindColorCycleRuntimeLayerStrokeBuffersToAnimator(
            this.deps.getLayerDocumentRuntimeContext(),
            strokeState,
            animator,
          );
        }
      },
      applyDefBindings: (layerId, animator, strokeState) => {
        try {
          const defs = this.deps.getLayerMeta(layerId)?.gradientDefStore as Array<{
            id: number;
            hash: string;
            stops: GradientStop[];
          }> | undefined;
          if (animator) {
            this.deps.applyDefBindingsForLayer(layerId, animator, strokeState, defs);
          }
        } catch {}
      },
      snapshotFromBuffers: (strokeState) => snapshotColorCycleRuntimeLayerStrokeStateFromBuffers(
        this.deps.getLayerDocumentRuntimeContext(),
        strokeState,
      ),
      getAnimatorDimensions: (animator) => animator?.getDimensions?.(),
      markDirtyBounds: (animator, bounds) => animator?.markDirtyBounds(bounds),
      markLayerDirty: (layerId) => this.deps.markLayerDirty(layerId),
    };
  }
}
