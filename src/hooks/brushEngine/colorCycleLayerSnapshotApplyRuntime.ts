import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { GradientStop } from '@/lib/GradientPalette';
import {
  createColorCycleRuntimeRestoreIncomingSnapshot,
  executeColorCycleBrushLayerSnapshotRuntimeApply,
  resolveColorCycleRuntimeRestore,
  type ColorCycleBrushAnimatorIndexInput,
  type ColorCycleBrushLayerSnapshotAnimatorDimensions,
  type ColorCycleBrushLayerSnapshotApplyResult,
  type ColorCycleBrushLayerSnapshotDirtyBounds,
  type ColorCycleBrushLayerSnapshotFallbackFlowMode,
  type ColorCycleBrushLayerSnapshotInput,
  type ColorCycleBrushLayerSnapshotStrokeStateCommit,
  type CreateColorCycleBrushLayerSnapshotFallbackAnimationPlanOptions,
} from '@/lib/colorCycle/document';
import type { GradientSeamProfile } from '@/lib/colorCycle/gradientSeamProfile';
import type { Layer } from '@/types';
import {
  logCCMutation,
  summarizeColorCycleLayer,
} from '@/utils/colorCycle/ccMutationAudit';

import type {
  AnimatorIndexSnapshot,
  ColorCycleRuntimeMutationReason,
  ColorCycleRuntimeMutationSource,
  LayerStrokeState,
  StrokeDataSnapshot,
  ColorCycleRuntimeMutationAuditSnapshot,
} from './colorCycleCanvas2DTypes';

export type ColorCycleLayerSnapshotApplyContext = {
  canvasWidth: number;
  canvasHeight: number;
  flowSlotMask: number;
  getLayer(layerId: string): Layer | undefined;
  getExistingStrokeState(layerId: string): LayerStrokeState | undefined;
  hasCanonicalPaintPayload(layerId: string): boolean;
  brushStateHasPaintPayload(layerId: string): boolean;
  ensureAnimator(layerId: string): ColorCycleAnimator | null | undefined;
  resizeAnimator(animator: ColorCycleAnimator, width: number, height: number): void;
  createStrokeState(options: { hasContent: boolean; bufferSize: number }): LayerStrokeState;
  captureAuditSnapshot(
    layerId: string,
    strokeState: LayerStrokeState | undefined,
  ): ColorCycleRuntimeMutationAuditSnapshot | null;
  getFallbackAnimationPlanOptions(layerId: string): CreateColorCycleBrushLayerSnapshotFallbackAnimationPlanOptions;
  encodeFallbackSpeedByte(speed: number): number;
  encodeFallbackFlowByte(flowMode: ColorCycleBrushLayerSnapshotFallbackFlowMode): number;
  applySlotPalette(
    layerId: string,
    slot: number,
    stops: GradientStop[],
    seamProfile?: GradientSeamProfile,
  ): void;
  applyActiveGradientSlot(layerId: string, slot: number): void;
  publishStrokeState(
    layerId: string,
    strokeState: LayerStrokeState,
    publish: ColorCycleBrushLayerSnapshotStrokeStateCommit['publish'],
  ): void;
  recordClearAudit(operation: {
    layerId: string;
    reason: ColorCycleRuntimeMutationReason;
    source: ColorCycleRuntimeMutationSource;
    expectedDestructive: boolean;
    before: ColorCycleRuntimeMutationAuditSnapshot | null;
    after: ColorCycleRuntimeMutationAuditSnapshot | null;
  }): void;
  setIndexBuffers(
    animator: ColorCycleAnimator | null | undefined,
    result: ColorCycleBrushLayerSnapshotApplyResult,
  ): void;
  bindStrokeBuffersToAnimator(
    strokeState: LayerStrokeState,
    animator: ColorCycleAnimator | null | undefined,
  ): void;
  applyDefBindings(
    layerId: string,
    animator: ColorCycleAnimator | null | undefined,
    strokeState: LayerStrokeState,
  ): void;
  snapshotFromBuffers(strokeState: LayerStrokeState): void;
  getAnimatorDimensions(
    animator: ColorCycleAnimator | null | undefined,
  ): ColorCycleBrushLayerSnapshotAnimatorDimensions | null | undefined;
  markDirtyBounds(
    animator: ColorCycleAnimator | null | undefined,
    bounds: ColorCycleBrushLayerSnapshotDirtyBounds,
  ): void;
  markLayerDirty(layerId: string): void;
};

export function applyColorCycleLayerSnapshotRuntime(
  context: ColorCycleLayerSnapshotApplyContext,
  layerId: string,
  snapshot: StrokeDataSnapshot,
  animatorIndex?: AnimatorIndexSnapshot,
  reason: ColorCycleRuntimeMutationReason = 'snapshot-apply',
  options?: { suppressClearAudit?: boolean },
): void {
  executeColorCycleBrushLayerSnapshotRuntimeApply({
    layerId,
    snapshot,
    animatorIndex,
    reason,
    suppressClearAudit: options?.suppressClearAudit,
    canvasWidth: context.canvasWidth,
    canvasHeight: context.canvasHeight,
    flowSlotMask: context.flowSlotMask,
    getExistingStrokeState: (targetLayerId) => context.getExistingStrokeState(targetLayerId),
    hasCanonicalPaintPayload: (targetLayerId) => context.hasCanonicalPaintPayload(targetLayerId),
    resolveRestoreAction: (operation) => {
      const layer = context.getLayer(operation.layerId);
      return layer
        ? resolveColorCycleRuntimeRestore({
            layer,
            incomingSnapshot: createColorCycleRuntimeRestoreIncomingSnapshot(operation),
            projectLoadRestore: operation.projectLoadRestore,
          })
        : null;
    },
    brushStateHasPaintPayload: (targetLayerId) => context.brushStateHasPaintPayload(targetLayerId),
    logBlockedWrite: (operation) => {
      const layer = context.getLayer(operation.layerId);
      logCCMutation({
        event: 'cc-empty-live-buffer-write-blocked',
        layerId: operation.layerId,
        reason: 'applyLayerSnapshot',
        severity: operation.severity,
        before: summarizeColorCycleLayer(layer),
        after: summarizeColorCycleLayer(layer),
        details: operation.details,
      });
    },
    applyRecoveredSnapshot: (operation) => {
      applyColorCycleLayerSnapshotRuntime(
        context,
        operation.layerId,
        operation.snapshot as StrokeDataSnapshot,
        operation.animatorIndex as AnimatorIndexSnapshot | undefined,
        operation.reason as ColorCycleRuntimeMutationReason,
        { suppressClearAudit: true },
      );
    },
    ensureAnimator: (targetLayerId) => context.ensureAnimator(targetLayerId),
    resizeAnimator: (animator, width, height) => context.resizeAnimator(animator, width, height),
    createStrokeState: (createOptions) => context.createStrokeState(createOptions),
    captureAuditSnapshot: (targetLayerId, strokeState) => context.captureAuditSnapshot(targetLayerId, strokeState),
    getFallbackAnimationPlanOptions: (targetLayerId) => context.getFallbackAnimationPlanOptions(targetLayerId),
    encodeFallbackSpeedByte: (speed) => context.encodeFallbackSpeedByte(speed),
    encodeFallbackFlowByte: (flowMode) => context.encodeFallbackFlowByte(flowMode),
    applySlotPalette: (slot, stops, seamProfile) => {
      context.applySlotPalette(layerId, slot, stops, seamProfile as GradientSeamProfile | undefined);
    },
    applyActiveGradientSlot: (slot) => context.applyActiveGradientSlot(layerId, slot),
    publishStrokeState: (targetLayerId, strokeState, publish) => {
      context.publishStrokeState(targetLayerId, strokeState, publish);
    },
    recordClearAudit: (operation) => {
      context.recordClearAudit({
        layerId: operation.layerId,
        reason: operation.reason as ColorCycleRuntimeMutationReason,
        source: operation.source,
        expectedDestructive: operation.expectedDestructive,
        before: operation.before,
        after: operation.after,
      });
    },
    setIndexBuffers: (animator, result) => context.setIndexBuffers(animator, result),
    bindStrokeBuffersToAnimator: (strokeState, animator) => context.bindStrokeBuffersToAnimator(strokeState, animator),
    applyDefBindings: (targetLayerId, animator, strokeState) => {
      context.applyDefBindings(targetLayerId, animator, strokeState);
    },
    snapshotFromBuffers: (strokeState) => context.snapshotFromBuffers(strokeState),
    getAnimatorDimensions: (animator) => context.getAnimatorDimensions(animator),
    markDirtyBounds: (animator, bounds) => context.markDirtyBounds(animator, bounds),
    markLayerDirty: (targetLayerId) => {
      context.markLayerDirty(targetLayerId);
    },
  });
}

export type ColorCycleLayerSnapshotApplyRuntimeInput = {
  snapshot: ColorCycleBrushLayerSnapshotInput;
  animatorIndex?: ColorCycleBrushAnimatorIndexInput;
};
