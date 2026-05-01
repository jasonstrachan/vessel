import type { Layer } from '@/types';

import type {
  ColorCyclePersistenceDocumentState,
  DeferredColorCycleArchiveRuntime,
  PersistedColorCycleBrushState,
  PersistedColorCycleLayerSnapshot,
} from './colorCyclePersistenceTypes';
import { cloneBufferRef, getLayerSnapshot } from './colorCyclePersistenceValidation';

const resolveDimensions = (
  layer: Layer,
  fallbackWidth: number,
  fallbackHeight: number,
): { width: number; height: number } => {
  const colorCycleData = layer.colorCycleData;
  return {
    width: Math.max(1, Math.floor(
      colorCycleData?.canvasWidth ??
      colorCycleData?.canvasImageData?.width ??
      colorCycleData?.canvas?.width ??
      layer.imageData?.width ??
      fallbackWidth ??
      1,
    )),
    height: Math.max(1, Math.floor(
      colorCycleData?.canvasHeight ??
      colorCycleData?.canvasImageData?.height ??
      colorCycleData?.canvas?.height ??
      layer.imageData?.height ??
      fallbackHeight ??
      1,
    )),
  };
};

const snapshotToDocumentState = (
  layer: Layer,
  snapshot: PersistedColorCycleLayerSnapshot,
  brushState: PersistedColorCycleBrushState,
  fallbackWidth: number,
  fallbackHeight: number,
): ColorCyclePersistenceDocumentState => {
  const dimensions = snapshot.dimensions ??
    brushState.dimensionsByLayerId?.[layer.id] ??
    resolveDimensions(layer, fallbackWidth, fallbackHeight);
  const colorCycleData = layer.colorCycleData;
  const strokeData = snapshot.strokeData;
  return {
    layerId: layer.id,
    width: dimensions.width,
    height: dimensions.height,
    paintBuffer: cloneBufferRef(strokeData?.paintBuffer),
    gradientIdBuffer: cloneBufferRef(strokeData?.gradientIdBuffer ?? colorCycleData?.gradientIdBuffer),
    gradientDefIdBuffer: cloneBufferRef(strokeData?.gradientDefIdBuffer ?? colorCycleData?.gradientDefIdBuffer),
    speedBuffer: cloneBufferRef(strokeData?.speedBuffer),
    flowBuffer: cloneBufferRef(strokeData?.flowBuffer),
    phaseBuffer: cloneBufferRef(strokeData?.phaseBuffer ?? colorCycleData?.phaseBuffer),
    slotPalettes: snapshot.slotPalettes ?? colorCycleData?.slotPalettes,
    gradientDefs: snapshot.gradientDefs ?? colorCycleData?.gradientDefs,
    gradientDefStore: snapshot.gradientDefStore ?? colorCycleData?.gradientDefStore,
    activeGradientId: snapshot.activeGradientId ?? colorCycleData?.activeGradientId,
    paintSlot: snapshot.paintSlot ?? colorCycleData?.paintSlot,
    fgActiveSlot: snapshot.fgActiveSlot ?? colorCycleData?.fgActiveSlot,
    layerBaseSpeedCps: colorCycleData?.layerBaseSpeedCps ?? colorCycleData?.controllerSpeedCps,
    flowMode: colorCycleData?.flowMode,
    hasContent: Boolean(strokeData?.hasContent ?? colorCycleData?.hasContent ?? strokeData?.paintBuffer),
    sources: {
      brushStateSnapshot: true,
      topLevelBuffers: Boolean(colorCycleData?.gradientIdBuffer || colorCycleData?.gradientDefIdBuffer || colorCycleData?.phaseBuffer),
      legacyStateRefs: false,
    },
  };
};

export const emitColorCycleDocumentStateFromBrushState = (
  layer: Layer,
  brushState: PersistedColorCycleBrushState,
  fallbackWidth: number,
  fallbackHeight: number,
): ColorCyclePersistenceDocumentState | undefined => {
  const snapshot = getLayerSnapshot(brushState, layer.id);
  if (!snapshot) {
    return undefined;
  }
  return snapshotToDocumentState(layer, snapshot, brushState, fallbackWidth, fallbackHeight);
};

export const emitColorCycleDocumentStateFromDeferredArchive = (
  layer: Layer,
  deferred: DeferredColorCycleArchiveRuntime,
  fallbackWidth: number,
  fallbackHeight: number,
): ColorCyclePersistenceDocumentState | undefined => {
  if (deferred.brushState) {
    const state = emitColorCycleDocumentStateFromBrushState(layer, deferred.brushState, fallbackWidth, fallbackHeight);
    if (state) {
      return {
        ...state,
        paintBuffer: state.paintBuffer ?? deferred.paintRef,
        gradientIdBuffer: state.gradientIdBuffer ?? deferred.gradientIdRef,
        gradientDefIdBuffer: state.gradientDefIdBuffer ?? deferred.gradientDefIdRef,
        speedBuffer: state.speedBuffer ?? deferred.speedRef,
        flowBuffer: state.flowBuffer ?? deferred.flowRef,
        phaseBuffer: state.phaseBuffer ?? deferred.phaseRef,
      };
    }
  }

  const dimensions = resolveDimensions(layer, fallbackWidth, fallbackHeight);
  return {
    layerId: layer.id,
    width: dimensions.width,
    height: dimensions.height,
    paintBuffer: deferred.paintRef,
    gradientIdBuffer: deferred.gradientIdRef,
    gradientDefIdBuffer: deferred.gradientDefIdRef,
    speedBuffer: deferred.speedRef,
    flowBuffer: deferred.flowRef,
    phaseBuffer: deferred.phaseRef,
    slotPalettes: layer.colorCycleData?.slotPalettes,
    gradientDefs: layer.colorCycleData?.gradientDefs,
    gradientDefStore: layer.colorCycleData?.gradientDefStore,
    activeGradientId: layer.colorCycleData?.activeGradientId,
    paintSlot: layer.colorCycleData?.paintSlot,
    fgActiveSlot: layer.colorCycleData?.fgActiveSlot,
    layerBaseSpeedCps: layer.colorCycleData?.layerBaseSpeedCps ?? layer.colorCycleData?.controllerSpeedCps,
    flowMode: layer.colorCycleData?.flowMode,
    hasContent: Boolean(layer.colorCycleData?.hasContent ?? deferred.paintRef),
    sources: {
      brushStateSnapshot: false,
      topLevelBuffers: false,
      legacyStateRefs: true,
    },
  };
};
