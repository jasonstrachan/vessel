import type { Layer } from '@/types';

import {
  emitColorCycleDocumentStateFromBrushState,
  emitColorCycleDocumentStateFromDeferredArchive,
} from './emitColorCycleDocumentState';
import { resolveColorCyclePersistenceSource } from './resolveColorCyclePersistenceSource';
import type {
  CaptureColorCyclePersistenceSnapshotContext,
  ColorCyclePersistenceSnapshot,
} from './colorCyclePersistenceTypes';
import {
  classifyBrushStateFailure,
  getLayerSnapshot,
  validatePersistenceDocumentState,
} from './colorCyclePersistenceValidation';

export const captureColorCyclePersistenceSnapshot = (
  layer: Layer,
  context: CaptureColorCyclePersistenceSnapshotContext,
): ColorCyclePersistenceSnapshot => {
  if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
    return {
      ok: false,
      layerId: layer.id,
      mode: context.mode,
      reason: 'missing-color-cycle-data',
      diagnostics: [{
        kind: 'metadata-only',
        message: 'Layer is not a color-cycle layer or has no color-cycle data.',
      }],
    };
  }

  const sourceResult = resolveColorCyclePersistenceSource(layer, context);
  if (!sourceResult.ok) {
    const missingArchiveRef = sourceResult.diagnostics.some((diagnostic) => diagnostic.kind === 'missing-archive-ref');
    if (missingArchiveRef) {
      return {
        ok: false,
        layerId: layer.id,
        mode: context.mode,
        reason: 'missing-archive-ref',
        damageKind: 'missing-archive-ref',
        previewImageData: context.mode === 'import-repair' ? layer.colorCycleData.canvasImageData : undefined,
        diagnostics: sourceResult.diagnostics,
      };
    }
    const persistedBrushState = layer.colorCycleData.brushState as Parameters<typeof classifyBrushStateFailure>[0];
    const failure = classifyBrushStateFailure(
      persistedBrushState,
      getLayerSnapshot(persistedBrushState, layer.id),
    );
    return {
      ok: false,
      layerId: layer.id,
      mode: context.mode,
      reason: failure.reason,
      damageKind: failure.damageKind,
      previewImageData: context.mode === 'import-repair' ? layer.colorCycleData.canvasImageData : undefined,
      diagnostics: [...sourceResult.diagnostics, ...failure.diagnostics],
    };
  }

  const documentState = sourceResult.source === 'deferred-archive'
    ? sourceResult.deferredRuntime
      ? emitColorCycleDocumentStateFromDeferredArchive(
          layer,
          sourceResult.deferredRuntime,
          context.projectWidth,
          context.projectHeight,
        )
      : undefined
    : emitColorCycleDocumentStateFromBrushState(
        layer,
        sourceResult.brushState,
        context.projectWidth,
        context.projectHeight,
      );

  if (!documentState) {
    return {
      ok: false,
      layerId: layer.id,
      mode: context.mode,
      reason: 'missing-canonical-paint',
      damageKind: 'missing-paint-buffer',
      diagnostics: sourceResult.diagnostics,
    };
  }

  const validation = validatePersistenceDocumentState(documentState, {
    requirePaint: context.requirePaint,
    source: sourceResult.source,
  });
  if (!validation.ok) {
    return {
      ok: false,
      layerId: layer.id,
      mode: context.mode,
      reason: validation.reason,
      damageKind: validation.damageKind,
      previewImageData: context.mode === 'import-repair' ? layer.colorCycleData.canvasImageData : undefined,
      diagnostics: [...sourceResult.diagnostics, ...validation.diagnostics],
    };
  }
  const paintBuffer = documentState.paintBuffer;
  if (!paintBuffer) {
    return {
      ok: false,
      layerId: layer.id,
      mode: context.mode,
      reason: 'missing-canonical-paint',
      damageKind: 'missing-paint-buffer',
      diagnostics: sourceResult.diagnostics,
    };
  }

  return {
    ok: true,
    source: sourceResult.source,
    mode: context.mode,
    layerId: layer.id,
    documentState: {
      ...documentState,
      paintBuffer,
    },
    brushState: sourceResult.brushState,
    diagnostics: sourceResult.diagnostics,
  };
};
