import type { Layer } from '@/types';
import {
  readColorCycleBrushSerializedStateFromRuntime,
} from '@/lib/colorCycle/document';

import {
  emitColorCycleDocumentStateFromBrushState,
  emitColorCycleDocumentStateFromDeferredArchive,
} from './emitColorCycleDocumentState';
import { resolveColorCyclePersistenceSource } from './resolveColorCyclePersistenceSource';
import type { ResolvedColorCyclePersistenceSource } from './resolveColorCyclePersistenceSource';
import type {
  CaptureColorCyclePersistenceSnapshotContext,
  DeferredColorCycleArchiveRuntime,
  ColorCycleBufferRef,
  ColorCycleLayerDocumentReader,
  ColorCyclePersistenceDocumentState,
  ColorCyclePersistenceSnapshot,
  PersistedColorCycleBrushState,
} from './colorCyclePersistenceTypes';
import {
  AUTHORED_SPEED_SOURCE_VERSION,
  LEGACY_EFFECTIVE_SPEED_SOURCE_VERSION,
  type ColorCycleSpeedSourceVersion,
} from './colorCyclePersistenceTypes';
import {
  classifyBrushStateFailure,
  cloneBufferRef,
  getLayerSnapshot,
  validatePersistenceDocumentState,
} from './colorCyclePersistenceValidation';

const cloneDocumentStateForPersistence = (
  state: ColorCyclePersistenceDocumentState,
): ColorCyclePersistenceDocumentState => ({
  ...state,
  paintBuffer: cloneBufferRef(state.paintBuffer),
  gradientIdBuffer: cloneBufferRef(state.gradientIdBuffer),
  gradientDefIdBuffer: cloneBufferRef(state.gradientDefIdBuffer),
  speedBuffer: cloneBufferRef(state.speedBuffer),
  flowBuffer: cloneBufferRef(state.flowBuffer),
  phaseBuffer: cloneBufferRef(state.phaseBuffer),
  slotPalettes: state.slotPalettes?.map((palette) => ({
    ...palette,
    stops: palette.stops.map((stop) => ({ ...stop })),
  })),
  gradientDefs: state.gradientDefs?.map((entry) => ({ ...entry })),
  gradientDefStore: state.gradientDefStore?.map((entry) => ({
    ...entry,
    stops: entry.stops.map((stop) => ({ ...stop })),
  })),
  sources: { ...state.sources },
});

const referenceDocumentStateForHistory = (
  state: ColorCyclePersistenceDocumentState,
): ColorCyclePersistenceDocumentState => ({
  ...state,
  slotPalettes: state.slotPalettes?.map((palette) => ({
    ...palette,
    stops: palette.stops.map((stop) => ({ ...stop })),
  })),
  gradientDefs: state.gradientDefs?.map((entry) => ({ ...entry })),
  gradientDefStore: state.gradientDefStore?.map((entry) => ({
    ...entry,
    stops: entry.stops.map((stop) => ({ ...stop })),
  })),
  sources: { ...state.sources },
});

const createBrushStateFromDocumentState = (
  documentState: ColorCyclePersistenceDocumentState & { paintBuffer: ColorCycleBufferRef },
  options: {
    referenceBuffers?: boolean;
    speedSourceVersion?: ColorCycleSpeedSourceVersion;
  } = {},
): PersistedColorCycleBrushState => ({
  canonicalPaint: true,
  schemaVersion: 1,
  dimensionsByLayerId: {
    [documentState.layerId]: {
      width: documentState.width,
      height: documentState.height,
    },
  },
  layers: [{
    layerId: documentState.layerId,
    canonicalPaint: true,
    schemaVersion: 1,
    dimensions: {
      width: documentState.width,
      height: documentState.height,
    },
    strokeData: {
      paintBuffer: options.referenceBuffers
        ? documentState.paintBuffer
        : cloneBufferRef(documentState.paintBuffer),
      gradientIdBuffer: options.referenceBuffers
        ? documentState.gradientIdBuffer
        : cloneBufferRef(documentState.gradientIdBuffer),
      gradientDefIdBuffer: options.referenceBuffers
        ? documentState.gradientDefIdBuffer
        : cloneBufferRef(documentState.gradientDefIdBuffer),
      speedBuffer: options.referenceBuffers
        ? documentState.speedBuffer
        : cloneBufferRef(documentState.speedBuffer),
      speedSourceVersion: options.speedSourceVersion ?? AUTHORED_SPEED_SOURCE_VERSION,
      flowBuffer: options.referenceBuffers
        ? documentState.flowBuffer
        : cloneBufferRef(documentState.flowBuffer),
      phaseBuffer: options.referenceBuffers
        ? documentState.phaseBuffer
        : cloneBufferRef(documentState.phaseBuffer),
      hasContent: documentState.hasContent,
      strokeCounter: 0,
    },
    gradientDefs: documentState.gradientDefs,
    slotPalettes: documentState.slotPalettes,
    gradientDefStore: documentState.gradientDefStore,
    paintSlot: documentState.paintSlot,
    fgActiveSlot: documentState.fgActiveSlot,
    activeGradientId: documentState.activeGradientId,
  }],
});

const captureSerializedRuntimeBrushMetadata = (
  layer: Layer,
  context: CaptureColorCyclePersistenceSnapshotContext,
): PersistedColorCycleBrushState | undefined => {
  const brush =
    context.runtimeBrush ??
    context.runtimeBrushManager?.getSerializedStateBrush?.(layer.id);
  if (!brush || !context.serializeRuntimeBrushState) {
    return layer.colorCycleData?.brushState as PersistedColorCycleBrushState | undefined;
  }

  const rawState = readColorCycleBrushSerializedStateFromRuntime(brush);

  if (context.serializeRuntimeBrushState) {
    return context.serializeRuntimeBrushState(rawState, layer.id)
      ?? layer.colorCycleData?.brushState as PersistedColorCycleBrushState | undefined;
  }

  return (rawState as PersistedColorCycleBrushState | undefined)
    ?? layer.colorCycleData?.brushState as PersistedColorCycleBrushState | undefined;
};

const createDeferredRuntimeFromColdDocument = (
  layer: Layer,
  context: CaptureColorCyclePersistenceSnapshotContext,
  document: ColorCycleLayerDocumentReader,
): DeferredColorCycleArchiveRuntime | undefined => {
  if (document.residency !== 'cold-archive-ref') {
    return undefined;
  }

  const archiveRefs = document.archiveRefs;
  if (!archiveRefs) {
    return undefined;
  }

  return {
    brushState: (
      context.deferredRuntime?.brushState ??
      layer.colorCycleData?.brushState
    ) as PersistedColorCycleBrushState | undefined,
    paintRef: archiveRefs.paintRef ?? context.deferredRuntime?.paintRef,
    gradientIdRef: archiveRefs.gradientIdRef ?? context.deferredRuntime?.gradientIdRef,
    gradientDefIdRef: archiveRefs.gradientDefIdRef ?? context.deferredRuntime?.gradientDefIdRef,
    speedRef: archiveRefs.speedRef ?? context.deferredRuntime?.speedRef,
    flowRef: archiveRefs.flowRef ?? context.deferredRuntime?.flowRef,
    phaseRef: archiveRefs.phaseRef ?? context.deferredRuntime?.phaseRef,
  };
};

const mergeDocumentBrushStateMetadata = (
  documentBrushState: PersistedColorCycleBrushState,
  metadataBrushState: PersistedColorCycleBrushState | undefined,
  layerId: string,
): PersistedColorCycleBrushState => {
  if (!metadataBrushState) {
    return documentBrushState;
  }

  const documentLayer = documentBrushState.layers?.find((snapshot) => snapshot.layerId === layerId);
  const metadataLayer = metadataBrushState.layers?.find((snapshot) => snapshot.layerId === layerId);
  const mergedLayer = documentLayer
    ? {
        ...metadataLayer,
        ...documentLayer,
        paintSlot: documentLayer.paintSlot ?? metadataLayer?.paintSlot,
        activeGradientId: documentLayer.activeGradientId ?? metadataLayer?.activeGradientId,
        fgActiveSlot: documentLayer.fgActiveSlot ?? metadataLayer?.fgActiveSlot,
        gradientDefs: documentLayer.gradientDefs ?? metadataLayer?.gradientDefs,
        slotPalettes: documentLayer.slotPalettes ?? metadataLayer?.slotPalettes,
        gradientDefStore: documentLayer.gradientDefStore ?? metadataLayer?.gradientDefStore,
        nextGradientDefId: documentLayer.nextGradientDefId ?? metadataLayer?.nextGradientDefId,
        strokeData: {
          ...metadataLayer?.strokeData,
          ...documentLayer.strokeData,
          strokeCounter: metadataLayer?.strokeData?.strokeCounter ?? documentLayer.strokeData?.strokeCounter,
        },
      }
    : undefined;

  return {
    ...metadataBrushState,
    ...documentBrushState,
    layers: mergedLayer
      ? [
          mergedLayer,
          ...(documentBrushState.layers ?? []).filter((snapshot) => snapshot.layerId !== layerId),
        ]
      : documentBrushState.layers,
  };
};

const captureFromColdArchiveDocument = (
  layer: Layer,
  context: CaptureColorCyclePersistenceSnapshotContext,
  document: ColorCycleLayerDocumentReader,
): ColorCyclePersistenceSnapshot | undefined => {
  const deferredRuntime = createDeferredRuntimeFromColdDocument(layer, context, document);
  if (!deferredRuntime) {
    return undefined;
  }

  const { version, pixelVersion } = document.read();
  const selectedDiagnostic = {
    source: 'document' as const,
    kind: 'source-selected' as const,
    message: `Selected cold color-cycle document archive refs from version ${version} as persistence source.`,
    documentVersion: version,
  };
  const documentState = emitColorCycleDocumentStateFromDeferredArchive(
    layer,
    deferredRuntime,
    context.projectWidth,
    context.projectHeight,
  );

  if (!documentState) {
    const diagnostics = [selectedDiagnostic, {
      source: 'document' as const,
      kind: 'source-rejected' as const,
      message: 'Cold color-cycle document archive refs could not produce canonical document state.',
      documentVersion: version,
    }];
    diagnostics.forEach((diagnostic) => context.diagnostics?.(diagnostic));
    return {
      ok: false,
      layerId: layer.id,
      mode: context.mode,
      reason: 'missing-canonical-paint',
      damageKind: 'missing-paint-buffer',
      diagnostics,
    };
  }

  const validation = validatePersistenceDocumentState(documentState, {
    requirePaint: context.requirePaint,
    source: 'document',
  });
  const diagnostics = [selectedDiagnostic, ...(validation.ok ? [] : validation.diagnostics)];
  diagnostics.forEach((diagnostic) => context.diagnostics?.(diagnostic));

  if (!validation.ok) {
    return {
      ok: false,
      layerId: layer.id,
      mode: context.mode,
      reason: validation.reason,
      damageKind: validation.damageKind,
      previewImageData: context.mode === 'import-repair' ? layer.colorCycleData?.canvasImageData : undefined,
      diagnostics,
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
      diagnostics,
    };
  }

  const brushState = mergeDocumentBrushStateMetadata(
    createBrushStateFromDocumentState({
      ...documentState,
      paintBuffer,
    }, {
      speedSourceVersion: getLayerSnapshot(deferredRuntime.brushState, layer.id)
        ?.strokeData?.speedSourceVersion
        ?? LEGACY_EFFECTIVE_SPEED_SOURCE_VERSION,
    }),
    captureSerializedRuntimeBrushMetadata(layer, context),
    layer.id,
  );

  return {
    ok: true,
    source: 'document',
    mode: context.mode,
    layerId: layer.id,
    documentVersion: version,
    pixelVersion,
    documentState: {
      ...documentState,
      paintBuffer,
    },
    brushState,
    diagnostics,
  };
};

const captureFromDocument = (
  layer: Layer,
  context: CaptureColorCyclePersistenceSnapshotContext,
): ColorCyclePersistenceSnapshot | undefined => {
  const document = context.document ?? context.runtimeBrushManager?.getDocument?.(layer.id);
  if (!document) {
    return undefined;
  }

  const coldArchiveCaptured = captureFromColdArchiveDocument(layer, context, document);
  if (coldArchiveCaptured) {
    return coldArchiveCaptured;
  }

  const { snapshot, version, pixelVersion } = document.read();
  // History only reads these buffers long enough to encode an ROI delta. A
  // document generation is immutable, so sharing it avoids copying the full
  // canvas synchronously before every stroke/shape. Save and export modes keep
  // their independent boundary copies because those buffers may be transferred.
  const referencesDocumentGeneration = context.mode === 'history';
  const documentState = referencesDocumentGeneration
    ? referenceDocumentStateForHistory(snapshot)
    : cloneDocumentStateForPersistence(snapshot);
  const validation = validatePersistenceDocumentState(documentState, {
    requirePaint: context.requirePaint,
    source: 'document',
  });
  const diagnostics = [{
    source: 'document' as const,
    kind: 'source-selected' as const,
    message: `Selected color-cycle document version ${version} as persistence source.`,
    documentVersion: version,
  }, ...(validation.ok ? [] : validation.diagnostics)];

  diagnostics.forEach((diagnostic) => context.diagnostics?.(diagnostic));

  if (!validation.ok) {
    return {
      ok: false,
      layerId: layer.id,
      mode: context.mode,
      reason: validation.reason,
      damageKind: validation.damageKind,
      previewImageData: context.mode === 'import-repair' ? layer.colorCycleData?.canvasImageData : undefined,
      diagnostics,
    };
  }

  if (!documentState.paintBuffer) {
    return {
      ok: false,
      layerId: layer.id,
      mode: context.mode,
      reason: 'missing-canonical-paint',
      damageKind: 'missing-paint-buffer',
      diagnostics,
    };
  }

  const runtimeBrushMetadata = captureSerializedRuntimeBrushMetadata(layer, context);
  const speedSourceVersion = getLayerSnapshot(runtimeBrushMetadata, layer.id)
    ?.strokeData?.speedSourceVersion;
  const brushState = mergeDocumentBrushStateMetadata(
    createBrushStateFromDocumentState({
      ...documentState,
      paintBuffer: documentState.paintBuffer,
    }, {
      referenceBuffers: referencesDocumentGeneration,
      speedSourceVersion,
    }),
    runtimeBrushMetadata,
    layer.id,
  );

  return {
    ok: true,
    source: 'document',
    mode: context.mode,
    layerId: layer.id,
    documentVersion: version,
    pixelVersion,
    documentState: {
      ...documentState,
      paintBuffer: documentState.paintBuffer,
    },
    brushState,
    diagnostics,
  };
};

const requiresDocumentSource = (
  mode: CaptureColorCyclePersistenceSnapshotContext['mode'],
): boolean => (
  mode === 'canonical-save' ||
  mode === 'autosave' ||
  mode === 'history' ||
  mode === 'export'
);

const emitDocumentState = (
  layer: Layer,
  context: CaptureColorCyclePersistenceSnapshotContext,
  sourceResult: Extract<ResolvedColorCyclePersistenceSource, { ok: true }>,
): ColorCyclePersistenceDocumentState | undefined => (
  sourceResult.source === 'deferred-archive'
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
      )
);

const captureFromResolvedSource = (
  layer: Layer,
  context: CaptureColorCyclePersistenceSnapshotContext,
  sourceResult: Extract<ResolvedColorCyclePersistenceSource, { ok: true }>,
): ColorCyclePersistenceSnapshot => {
  const documentState = emitDocumentState(layer, context, sourceResult);

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
      previewImageData: context.mode === 'import-repair' ? layer.colorCycleData?.canvasImageData : undefined,
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

  const documentCaptured = captureFromDocument(layer, context);
  if (documentCaptured) {
    return documentCaptured;
  }

  if (requiresDocumentSource(context.mode)) {
    const diagnostics = [{
      source: 'document' as const,
      kind: 'source-rejected' as const,
      message: 'No color-cycle document is available for this persistence boundary.',
    }];
    diagnostics.forEach((diagnostic) => context.diagnostics?.(diagnostic));
    return {
      ok: false,
      layerId: layer.id,
      mode: context.mode,
      reason: 'missing-document-source',
      diagnostics,
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

  const captured = captureFromResolvedSource(layer, context, sourceResult);
  if (
    captured?.ok === false &&
    sourceResult.source === 'live-runtime' &&
    !context.skipRuntime
  ) {
    const fallbackSourceResult = resolveColorCyclePersistenceSource(layer, {
      ...context,
      runtimeBrush: null,
      runtimeBrushManager: undefined,
      skipRuntime: true,
    });
    if (fallbackSourceResult.ok) {
      const fallbackCaptured = captureFromResolvedSource(layer, context, fallbackSourceResult);
      if (fallbackCaptured?.ok) {
        return {
          ...fallbackCaptured,
          diagnostics: [
            ...captured.diagnostics,
            {
              source: 'live-runtime',
              kind: 'source-rejected',
              message: 'Rejected incomplete live runtime state and preserved the next canonical color-cycle source.',
            },
            ...fallbackCaptured.diagnostics,
          ],
        };
      }
    }
  }

  return captured;
};
