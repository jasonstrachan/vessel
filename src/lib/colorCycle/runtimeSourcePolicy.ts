import type { Layer } from '@/types';
import {
  hasRecoverableColorCycleRuntimeSource,
} from '@/utils/colorCycle/resolveColorCycleRuntimeRestore';
import {
  captureColorCyclePersistenceSnapshot,
  type ColorCycleBufferRef,
  type ColorCyclePersistenceDiagnostic,
  type ColorCycleRuntimeBrush,
} from '@/lib/colorCycle/persistence';
import { validatePersistenceDocumentState } from '@/lib/colorCycle/persistence/colorCyclePersistenceValidation';

export type ColorCycleLegacyDocumentStateRefs = {
  hasContent?: boolean;
  paintRef?: unknown;
  gradientIdRef?: unknown;
  gradientDefIdRef?: unknown;
  speedRef?: unknown;
  flowRef?: unknown;
  phaseRef?: unknown;
};

export type ColorCycleRuntimeSourcePolicy = {
  isColorCycleLayer: boolean;
  hasEditableSource: boolean;
  hasRecoverableRuntimeSource: boolean;
  hasRuntimeRestoreSource: boolean;
  hasPlaybackWarmupSource: boolean;
  isPreviewOnly: boolean;
  diagnostics: ColorCyclePersistenceDiagnostic[];
};

export const getColorCycleLegacyDocumentStateRefs = (
  layer: Layer | null | undefined,
): ColorCycleLegacyDocumentStateRefs | null => {
  const state = (layer as unknown as { state?: unknown } | null | undefined)?.state;
  if (!state || typeof state !== 'object') {
    return null;
  }
  return state as ColorCycleLegacyDocumentStateRefs;
};

const hasBufferLikePayload = (value: unknown): boolean => {
  if (value instanceof ArrayBuffer) {
    return value.byteLength > 0;
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength > 0;
  }
  return typeof value === 'string' && value.length > 0;
};

export const getColorCycleBufferRef = (value: unknown): ColorCycleBufferRef | undefined => (
  hasBufferLikePayload(value) && (value instanceof ArrayBuffer || typeof value === 'string')
    ? value
    : undefined
);

const resolveColorCycleLayerDimensions = (
  layer: Layer,
): { width: number; height: number } => {
  const data = layer.colorCycleData;
  return {
    width: Math.max(1, Math.floor(
      data?.canvasWidth ??
      data?.canvas?.width ??
      layer.imageData?.width ??
      layer.framebuffer?.width ??
      1,
    )),
    height: Math.max(1, Math.floor(
      data?.canvasHeight ??
      data?.canvas?.height ??
      layer.imageData?.height ??
      layer.framebuffer?.height ??
      1,
    )),
  };
};

const hasValidLegacyDocumentEditSource = (
  layer: Layer,
  documentState: ColorCycleLegacyDocumentStateRefs | null,
  dimensions: { width: number; height: number },
): boolean => Boolean(
  documentState &&
  validatePersistenceDocumentState({
    layerId: layer.id,
    width: dimensions.width,
    height: dimensions.height,
    paintBuffer: getColorCycleBufferRef(documentState.paintRef),
    gradientIdBuffer: getColorCycleBufferRef(documentState.gradientIdRef),
    gradientDefIdBuffer: getColorCycleBufferRef(documentState.gradientDefIdRef),
    speedBuffer: getColorCycleBufferRef(documentState.speedRef),
    flowBuffer: getColorCycleBufferRef(documentState.flowRef),
    phaseBuffer: getColorCycleBufferRef(documentState.phaseRef),
    hasContent: Boolean(documentState.hasContent),
    sources: {
      brushStateSnapshot: false,
      topLevelBuffers: false,
      legacyStateRefs: true,
    },
  }, {
    requirePaint: true,
    source: 'deferred-archive',
  }).ok
);

const hasPotentialRuntimeBindingSource = (
  layer: Layer,
  documentState: ColorCycleLegacyDocumentStateRefs | null,
): boolean => {
  const brushState = layer.colorCycleData?.brushState as {
    layers?: Array<{
      strokeData?: {
        hasContent?: boolean;
        paintBuffer?: unknown;
        gradientIdBuffer?: unknown;
        gradientDefIdBuffer?: unknown;
      };
    }>;
  } | undefined;

  return Boolean(
    documentState?.hasContent === true ||
    hasBufferLikePayload(documentState?.paintRef) ||
    hasBufferLikePayload(documentState?.gradientIdRef) ||
    hasBufferLikePayload(documentState?.gradientDefIdRef) ||
    hasBufferLikePayload(layer.colorCycleData?.gradientIdBuffer) ||
    hasBufferLikePayload(layer.colorCycleData?.gradientDefIdBuffer) ||
    brushState?.layers?.some((snapshot) => (
      snapshot.strokeData?.hasContent === true ||
      hasBufferLikePayload(snapshot.strokeData?.paintBuffer) ||
      hasBufferLikePayload(snapshot.strokeData?.gradientIdBuffer) ||
      hasBufferLikePayload(snapshot.strokeData?.gradientDefIdBuffer)
    ))
  );
};

const hasCompleteEditablePersistenceSource = (
  layer: Layer,
  dimensions: { width: number; height: number },
  diagnostics: ColorCyclePersistenceDiagnostic[],
): boolean => {
  const data = layer.colorCycleData;
  const snapshot = captureColorCyclePersistenceSnapshot(layer, {
    projectWidth: dimensions.width,
    projectHeight: dimensions.height,
    requirePaint: true,
    mode: 'diagnostic',
    runtimeBrush: data?.colorCycleBrush as ColorCycleRuntimeBrush | undefined,
    diagnostics: (diagnostic) => diagnostics.push(diagnostic),
  });
  if (!snapshot.ok) {
    diagnostics.push(...snapshot.diagnostics);
  }
  return snapshot.ok;
};

export const resolveColorCycleRuntimeSourcePolicy = (
  layer: Layer | null | undefined,
): ColorCycleRuntimeSourcePolicy => {
  if (!layer || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return {
      isColorCycleLayer: false,
      hasEditableSource: false,
      hasRecoverableRuntimeSource: false,
      hasRuntimeRestoreSource: false,
      hasPlaybackWarmupSource: false,
      isPreviewOnly: false,
      diagnostics: [],
    };
  }

  const diagnostics: ColorCyclePersistenceDiagnostic[] = [];
  const dimensions = resolveColorCycleLayerDimensions(layer);
  const legacyDocumentState = getColorCycleLegacyDocumentStateRefs(layer);
  const hasEditableSource =
    hasValidLegacyDocumentEditSource(layer, legacyDocumentState, dimensions) ||
    hasCompleteEditablePersistenceSource(layer, dimensions, diagnostics);
  const hasRecoverableRuntimeSource = hasRecoverableColorCycleRuntimeSource(layer);
  const hasRuntimeRestoreSource = Boolean(
    hasEditableSource ||
    hasRecoverableRuntimeSource ||
    hasPotentialRuntimeBindingSource(layer, legacyDocumentState)
  );
  const hasPlaybackWarmupSource = layer.colorCycleData.repairStatus?.ok === false
    ? hasRecoverableRuntimeSource
    : Boolean(
        layer.colorCycleData.hasContent === true ||
        layer.colorCycleData.deferredRuntimeRestore === true ||
        legacyDocumentState?.hasContent === true ||
        hasRecoverableRuntimeSource
      );

  return {
    isColorCycleLayer: true,
    hasEditableSource,
    hasRecoverableRuntimeSource,
    hasRuntimeRestoreSource,
    hasPlaybackWarmupSource,
    isPreviewOnly: !hasRuntimeRestoreSource,
    diagnostics,
  };
};

export const hasColorCycleEditableRuntimeSource = (
  layer: Layer | null | undefined,
): boolean => resolveColorCycleRuntimeSourcePolicy(layer).hasEditableSource;

export const hasColorCycleWarmableRuntimeSource = (
  layer: Layer | null | undefined,
): boolean => {
  return resolveColorCycleRuntimeSourcePolicy(layer).hasRuntimeRestoreSource;
};
