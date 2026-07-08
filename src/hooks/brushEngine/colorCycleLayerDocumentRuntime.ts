import type {
  ColorCycleLayerDocument,
  ColorCycleDirtyRect,
  ColorCycleLayerDocumentState,
} from '@/lib/colorCycle/document';
import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import { encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';

import type {
  ColorCycleRuntimeMutationReason,
  ColorCycleRuntimeMutationSource,
  SerializedLayerColorCycleMeta,
  LayerStrokeState,
} from './colorCycleCanvas2DTypes';
import type { ColorCycleRuntimeDocumentState } from './colorCycleRuntimeDocumentState';
import {
  bindLayerStrokeBuffersToAnimator,
  createLayerStrokeState,
  snapshotLayerStrokeStateFromBuffers,
} from './colorCycleLayerStrokeBuffers';

type ColorCycleLayerDocumentDerivedSurface = {
  builtFromVersion: number | null;
  rebuild(snapshot: ReturnType<ColorCycleLayerDocument['read']>['snapshot'], version: number): void;
};

export type ColorCycleLayerStrokeStateMutationParams = {
  layerId: string;
  reason: ColorCycleRuntimeMutationReason;
  source: ColorCycleRuntimeMutationSource;
  expectedDestructive?: boolean;
  mutate: (strokeData: LayerStrokeState) => void;
  after?: {
    hasContent?: boolean;
    strokeCounter?: number;
  };
  markDirty?: boolean;
  forceDocumentPublish?: boolean;
  pixelsChanged?: boolean;
  dirtyRects?: ColorCycleDirtyRect[];
  takeDocumentStateOwnership?: boolean;
  assumeDerivedSurfaceCurrent?: boolean;
};

export type ColorCycleLayerDocumentRuntimeContext = {
  setLayerId(layerId: string): void;
  getLayerId(): string | null;
  setIsolated(isolated: boolean): void;
  ensureLayerDocument(
    layerId: string,
    buildInitialState: () => ColorCycleLayerDocumentState,
  ): ColorCycleLayerDocument;
  setLayerDocument(layerId: string, document: ColorCycleLayerDocument): void;
  getLayerDocument(layerId: string): ColorCycleLayerDocument | undefined;
  rebaseLayerDocument(params: Parameters<ColorCycleRuntimeDocumentState<LayerStrokeState>['rebaseLayerDocument']>[0]): void;
  deleteLayerDocument(layerId: string): void;
  getStrokeState(layerId: string): LayerStrokeState | undefined;
  ensureStrokeState(layerId: string, createStrokeState: () => LayerStrokeState): LayerStrokeState;
  buildDocumentStateFromStrokeState(
    params: Parameters<ColorCycleRuntimeDocumentState<LayerStrokeState>['buildDocumentStateFromStrokeState']>[0],
  ): ColorCycleLayerDocumentState;
  buildEmptyDocumentState(
    params: Parameters<ColorCycleRuntimeDocumentState<LayerStrokeState>['buildEmptyDocumentState']>[0],
  ): ColorCycleLayerDocumentState;
  setStrokeStateWithDocumentPublish(
    params: Parameters<ColorCycleRuntimeDocumentState<LayerStrokeState>['setStrokeStateWithDocumentPublish']>[0],
  ): void;
  mutateStrokeState(params: Parameters<ColorCycleRuntimeDocumentState<LayerStrokeState>['mutateStrokeState']>[0]): LayerStrokeState;
  clearStrokeStatesForReset(
    params: Parameters<ColorCycleRuntimeDocumentState<LayerStrokeState>['clearStrokeStatesForReset']>[0],
  ): void;
  getCanvasWidth(): number;
  getCanvasHeight(): number;
  getLayerMeta(layerId: string): SerializedLayerColorCycleMeta | null;
  getLayerBaseSpeedCps(): number;
  getResolvedWriteCycleSpeed(): number;
  getFlowMode(): ColorCycleLayerDocumentState['flowMode'];
  hasStrokeContent(strokeData: LayerStrokeState): boolean;
  getDerivedSurface(layerId: string): ColorCycleLayerDocumentDerivedSurface | null | undefined;
  markLayerDirty(layerId: string): void;
};

export function createColorCycleRuntimeLayerStrokeState(
  context: ColorCycleLayerDocumentRuntimeContext,
  options?: { hasContent?: boolean; bufferSize?: number; contentIsOptimistic?: boolean },
): LayerStrokeState {
  const size = Math.max(0, Math.floor(options?.bufferSize ?? context.getCanvasWidth() * context.getCanvasHeight()));
  const initialStrokeCycleSpeed = context.getResolvedWriteCycleSpeed();
  const initialStrokeSpeedByte = encodeColorCycleSpeedByte(initialStrokeCycleSpeed);
  return createLayerStrokeState({
    hasContent: options?.hasContent,
    bufferSize: size,
    contentIsOptimistic: options?.contentIsOptimistic,
    strokeCycleSpeed: initialStrokeCycleSpeed,
    strokeSpeedByte: initialStrokeSpeedByte,
  });
}

export function ensureColorCycleRuntimeLayerStrokeState(
  context: ColorCycleLayerDocumentRuntimeContext,
  layerId: string,
): LayerStrokeState {
  return context.ensureStrokeState(
    layerId,
    () => createColorCycleRuntimeLayerStrokeState(context, { hasContent: false }),
  );
}

export function bindColorCycleRuntimeLayerStrokeBuffersToAnimator(
  context: ColorCycleLayerDocumentRuntimeContext,
  strokeData: LayerStrokeState,
  animator: ColorCycleAnimator,
): void {
  bindLayerStrokeBuffersToAnimator(
    strokeData,
    animator,
    context.getCanvasWidth() * context.getCanvasHeight(),
  );
}

export function snapshotColorCycleRuntimeLayerStrokeStateFromBuffers(
  context: ColorCycleLayerDocumentRuntimeContext,
  strokeData: LayerStrokeState,
): void {
  snapshotLayerStrokeStateFromBuffers(
    strokeData,
    context.hasStrokeContent(strokeData),
  );
}

export function buildColorCycleRuntimeDocumentStateFromStrokeState(
  context: ColorCycleLayerDocumentRuntimeContext,
  layerId: string,
  strokeData: LayerStrokeState,
): ColorCycleLayerDocumentState {
  return context.buildDocumentStateFromStrokeState({
    layerId,
    width: context.getCanvasWidth(),
    height: context.getCanvasHeight(),
    strokeState: strokeData,
    meta: context.getLayerMeta(layerId),
    layerBaseSpeedCps: context.getLayerBaseSpeedCps(),
    flowMode: context.getFlowMode(),
    hasStrokeContent: (state) => context.hasStrokeContent(state),
  });
}

export function buildEmptyColorCycleRuntimeDocumentState(
  context: ColorCycleLayerDocumentRuntimeContext,
  layerId: string,
): ColorCycleLayerDocumentState {
  return context.buildEmptyDocumentState({
    layerId,
    width: context.getCanvasWidth(),
    height: context.getCanvasHeight(),
  });
}

export function setColorCycleRuntimeLayerStrokeState(
  context: ColorCycleLayerDocumentRuntimeContext,
  layerId: string,
  strokeData: LayerStrokeState,
  options?: { publishToDocument?: boolean; reason?: ColorCycleRuntimeMutationReason },
): void {
  context.setStrokeStateWithDocumentPublish({
    layerId,
    strokeState: strokeData,
    publishToDocument: options?.publishToDocument,
    reason: options?.reason ?? 'snapshot-apply',
    buildDocumentState: () => buildColorCycleRuntimeDocumentStateFromStrokeState(
      context,
      layerId,
      strokeData,
    ),
    derivedSurface: context.getDerivedSurface(layerId),
  });
}

export function mutateColorCycleRuntimeLayerStrokeState(
  context: ColorCycleLayerDocumentRuntimeContext,
  params: ColorCycleLayerStrokeStateMutationParams,
): LayerStrokeState {
  return context.mutateStrokeState({
    ...params,
    createStrokeState: () => createColorCycleRuntimeLayerStrokeState(context, { hasContent: false }),
    width: context.getCanvasWidth(),
    height: context.getCanvasHeight(),
    getMeta: () => context.getLayerMeta(params.layerId),
    buildDocumentState: (strokeData) => buildColorCycleRuntimeDocumentStateFromStrokeState(
      context,
      params.layerId,
      strokeData,
    ),
    forceDocumentPublish: params.forceDocumentPublish,
    pixelsChanged: params.pixelsChanged,
    dirtyRects: params.dirtyRects,
    takeDocumentStateOwnership: params.takeDocumentStateOwnership,
    assumeDerivedSurfaceCurrent: params.assumeDerivedSurfaceCurrent,
    derivedSurface: context.getDerivedSurface(params.layerId),
    markLayerDirty: (layerId) => context.markLayerDirty(layerId),
  });
}

export function clearColorCycleRuntimeLayerStrokeStatesForReset(
  context: ColorCycleLayerDocumentRuntimeContext,
  reason: ColorCycleRuntimeMutationReason,
): void {
  context.clearStrokeStatesForReset({
    reason,
    width: context.getCanvasWidth(),
    height: context.getCanvasHeight(),
    getMeta: (layerId) => context.getLayerMeta(layerId),
  });
}

export function setColorCycleRuntimeLayerId(
  context: ColorCycleLayerDocumentRuntimeContext,
  layerId: string,
): void {
  context.setLayerId(layerId);
  context.ensureLayerDocument(
    layerId,
    () => buildEmptyColorCycleRuntimeDocumentState(context, layerId),
  );
}

export function setColorCycleRuntimeActiveLayerId(
  context: ColorCycleLayerDocumentRuntimeContext,
  layerId: string,
): void {
  context.setLayerId(layerId);
}

export function setColorCycleRuntimeLayerDocument(
  context: ColorCycleLayerDocumentRuntimeContext,
  layerId: string,
  document: ColorCycleLayerDocument,
): void {
  context.setLayerDocument(layerId, document);
}

export function getColorCycleRuntimeLayerDocument(
  context: ColorCycleLayerDocumentRuntimeContext,
  layerId: string,
): ColorCycleLayerDocument | undefined {
  return context.getLayerDocument(layerId);
}

export function rebaseColorCycleRuntimeLayerDocument(
  context: ColorCycleLayerDocumentRuntimeContext,
  layerId: string,
  options: {
    preserveVersion?: boolean;
    clearAudit?: boolean;
  } = {},
): void {
  context.rebaseLayerDocument({
    layerId,
    preserveVersion: options.preserveVersion,
    clearAudit: options.clearAudit,
    buildState: () => {
      const strokeData = context.getStrokeState(layerId);
      return strokeData
        ? buildColorCycleRuntimeDocumentStateFromStrokeState(context, layerId, strokeData)
        : buildEmptyColorCycleRuntimeDocumentState(context, layerId);
    },
  });
}

export function removeColorCycleRuntimeLayerDocument(
  context: ColorCycleLayerDocumentRuntimeContext,
  layerId: string,
): void {
  context.deleteLayerDocument(layerId);
}

export function getColorCycleRuntimeLayerId(
  context: ColorCycleLayerDocumentRuntimeContext,
): string | null {
  return context.getLayerId();
}

export function setColorCycleRuntimeIsolated(
  context: ColorCycleLayerDocumentRuntimeContext,
  isolated: boolean,
): void {
  context.setIsolated(isolated);
}
