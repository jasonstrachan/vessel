import type { ColorCycleRuntimeBrush } from './materializeColorCycleLayer';
import {
  captureColorCyclePersistenceSnapshot,
  type PersistedColorCycleBrushState as PersistenceBrushState,
} from '@/lib/colorCycle/persistence';
import { normalizeColorCycleLayerDocumentState } from '@/lib/colorCycle/documentState';
import {
  getColorCycleBrushManager,
  type ColorCycleBrushManager,
} from '@/stores/colorCycleBrushManager';
import {
  getColorCycleHydrationState,
  setColorCycleHydrationState,
} from '@/stores/layerHydration';
import type { Layer } from '@/types';
import {
  logCCMutation,
  summarizeColorCycleLayer,
} from '@/utils/colorCycle/ccMutationAudit';
import { hasRecoverableColorCycleRuntimeSource } from './resolveColorCycleRuntimeRestore';
import { readLegacyColorCycleTopLevelBuffers } from './legacyTopLevelBuffers';
import {
  canApplyColorCycleBrushLayerSnapshotToRuntime,
  type ColorCycleBrushLayerSnapshotRuntimeWriter,
  type ColorCycleBrushSerializedStateRuntimeWriter,
} from './brushPersistenceAdapter';

export type RestoreColorCycleBrushesOptions = {
  lazy?: boolean;
  activeLayerId?: string | null;
  colorCycleBrushManager?: ColorCycleBrushManager;
};

export type ColorCycleRestoreBrush = ColorCycleRuntimeBrush &
  ColorCycleBrushLayerSnapshotRuntimeWriter &
  ColorCycleBrushSerializedStateRuntimeWriter & {
    setTargetCanvas?: (canvas: HTMLCanvasElement | null) => void;
    setLayerId?: (layerId: string) => void;
    setPlaying?: (playing: boolean) => void;
    markLayerHasExternalBase?: (layerId: string) => void;
  };

export type ColorCycleRestoreBrushFactory = (
  layer: Layer,
  canvas: HTMLCanvasElement,
) => ColorCycleRestoreBrush;

type LazyColorCycleArchiveRuntimeLike = {
  paintRef?: string;
  speedRef?: string;
  flowRef?: string;
  phaseRef?: string;
  gradientIdRef?: string;
  gradientDefIdRef?: string;
};

type ColorCycleRestoreMaterializationResult = {
  brush: ColorCycleRuntimeBrush | null;
  materialized: boolean;
  reason?: string;
  documentVersion?: number | null;
};

type ColorCycleRuntimeSeedBrush = ColorCycleBrushLayerSnapshotRuntimeWriter;

type ColorCycleWarmRestoreDebug = {
  log: (event: string, details?: Record<string, unknown>) => void;
  warn: (event: string, details?: Record<string, unknown>) => void;
};

export type RestoreColorCycleBrushesHydrationDependencies = {
  shouldDeferColorCycleRuntimeRestore: (
    layer: Layer,
    options?: RestoreColorCycleBrushesOptions,
  ) => boolean;
  getLazyColorCycleArchiveRuntime: (layer: Layer) => LazyColorCycleArchiveRuntimeLike | undefined;
  hydrateLazyColorCycleArchiveRuntime: (layer: Layer) => Promise<void>;
  getSavedColorCycleBrushState: (layer: Layer) => PersistenceBrushState | undefined;
  serializeRuntimeBrushState: (state: unknown, layerId: string) => PersistenceBrushState | undefined;
  restoreLayerRuntimeForMaterialization: (
    layer: Layer,
    createColorCycleBrushForRestore: ColorCycleRestoreBrushFactory,
    canSeedFromPersistedBuffers: (
      colorCycleBrush: ColorCycleRuntimeSeedBrush,
      colorCycleData: NonNullable<Layer['colorCycleData']>,
    ) => boolean,
    documentRebaseOptions?: {
      preserveVersion?: boolean;
      clearAudit?: boolean;
    },
  ) => Promise<ColorCycleRestoreMaterializationResult>;
  describeBufferForDebug: (buffer: unknown) => { bytes: number; nonZeroSample: number } | null;
  isPrimaryColorCyclePayloadFailure: (reason: string) => boolean;
  toRepairStatusReasonForPrimaryPayloadFailure: (
    reason: string,
  ) => NonNullable<NonNullable<Layer['colorCycleData']>['repairStatus']>['reason'];
  withColorCycleDiagnosticNotes: (notes: string[], extra?: string[]) => string[];
  debug: ColorCycleWarmRestoreDebug;
};

export const restoreColorCycleBrushesWithDocumentHydration = async (
  layers: Layer[],
  options: RestoreColorCycleBrushesOptions | undefined,
  dependencies: RestoreColorCycleBrushesHydrationDependencies,
): Promise<Layer[]> => {
  const manager = options?.colorCycleBrushManager ?? getColorCycleBrushManager();
  const ensureLayerDocumentResidency = (
    layer: Layer,
    residency: 'cold-archive-ref' | 'static-preview-only',
  ): void => {
    const data = layer.colorCycleData;
    const width = Math.max(
      1,
      data?.canvasWidth ?? data?.canvas?.width ?? layer.imageData?.width ?? layer.framebuffer?.width ?? 1,
    );
    const height = Math.max(
      1,
      data?.canvasHeight ?? data?.canvas?.height ?? layer.imageData?.height ?? layer.framebuffer?.height ?? 1,
    );
    const lazyRuntime = dependencies.getLazyColorCycleArchiveRuntime(layer);
    manager.ensureDocument(layer.id, width, height, {
      residency,
      archiveRefs: residency === 'cold-archive-ref' && lazyRuntime
        ? {
            paintRef: lazyRuntime.paintRef,
            gradientIdRef: lazyRuntime.gradientIdRef,
            gradientDefIdRef: lazyRuntime.gradientDefIdRef,
            speedRef: lazyRuntime.speedRef,
            flowRef: lazyRuntime.flowRef,
            phaseRef: lazyRuntime.phaseRef,
          }
        : null,
    });
  };

  const createColorCycleBrushForRestore: ColorCycleRestoreBrushFactory = (layer, canvas) => {
    const width = Math.max(
      1,
      canvas.width || layer.colorCycleData?.canvasWidth || layer.imageData?.width || layer.framebuffer?.width || 1,
    );
    const height = Math.max(
      1,
      canvas.height || layer.colorCycleData?.canvasHeight || layer.imageData?.height || layer.framebuffer?.height || 1,
    );
    const managedBrush = manager.createBrush(layer.id, width, height);
    if (typeof managedBrush.setTargetCanvas === 'function') {
      managedBrush.setTargetCanvas(canvas);
    }
    return managedBrush;
  };

  const canSeedFromPersistedBuffers = (
    colorCycleBrush: ColorCycleRuntimeSeedBrush,
    colorCycleData: NonNullable<Layer['colorCycleData']>,
  ): boolean => {
    const persistedGradientIdBuffer = readLegacyColorCycleTopLevelBuffers(colorCycleData).gradientIdBuffer;
    const expectedSize = colorCycleData.canvas!.width * colorCycleData.canvas!.height;
    return (
      canApplyColorCycleBrushLayerSnapshotToRuntime(colorCycleBrush) &&
      persistedGradientIdBuffer instanceof ArrayBuffer &&
      persistedGradientIdBuffer.byteLength === expectedSize
    );
  };

  for (const layer of layers) {
    if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
      continue;
    }
    layer.colorCycleData.documentId = layer.id;

    if (
      layer.colorCycleData.repairStatus?.ok === false &&
      !hasRecoverableColorCycleRuntimeSource(layer)
    ) {
      const repairStatus = layer.colorCycleData.repairStatus;
      layer.colorCycleData = {
        ...setColorCycleHydrationState(layer.colorCycleData, 'cold'),
        deferredRuntimeRestore: false,
      };
      ensureLayerDocumentResidency(layer, 'static-preview-only');
      dependencies.debug.warn('repair-failed-skip-runtime-restore', {
        layerId: layer.id,
        reason: repairStatus.reason,
      });
      continue;
    }

    const shouldDefer = dependencies.shouldDeferColorCycleRuntimeRestore(layer, options);
    dependencies.debug.log('layer-enter', {
      layerId: layer.id,
      name: layer.name,
      defer: shouldDefer,
      activeLayerId: options?.activeLayerId,
      hydration: getColorCycleHydrationState(layer.colorCycleData),
      hasBrush: Boolean(layer.colorCycleData.colorCycleBrush),
      hasBrushState: Boolean(dependencies.getSavedColorCycleBrushState(layer)),
      hasCanvasImageData: Boolean(layer.colorCycleData.canvasImageData),
      legacyTopLevelBuffers: {
        gradientIdBuffer: dependencies.describeBufferForDebug(
          readLegacyColorCycleTopLevelBuffers(layer.colorCycleData).gradientIdBuffer,
        ),
        gradientDefIdBuffer: dependencies.describeBufferForDebug(
          readLegacyColorCycleTopLevelBuffers(layer.colorCycleData).gradientDefIdBuffer,
        ),
      },
    });

    if (shouldDefer) {
      layer.colorCycleData = setColorCycleHydrationState(layer.colorCycleData, 'cold');
      ensureLayerDocumentResidency(layer, 'cold-archive-ref');
      dependencies.debug.log('deferred-cold', {
        layerId: layer.id,
        reason: 'shouldDeferColorCycleRuntimeRestore',
      });
      continue;
    }

    const targetRuntimeState = options?.activeLayerId === layer.id ? 'active' : 'warm';
    const hadLazyArchiveRuntime = Boolean(dependencies.getLazyColorCycleArchiveRuntime(layer));
    const shouldValidateWarmupPrimaryPayload = Boolean(
      hadLazyArchiveRuntime ||
      layer.colorCycleData.deferredRuntimeRestore === true ||
      getColorCycleHydrationState(layer.colorCycleData) === 'cold'
    );
    await dependencies.hydrateLazyColorCycleArchiveRuntime(layer);
    dependencies.debug.log('archive-runtime-hydrated', {
      layerId: layer.id,
      legacyTopLevelBuffers: {
        gradientIdBuffer: dependencies.describeBufferForDebug(
          readLegacyColorCycleTopLevelBuffers(layer.colorCycleData).gradientIdBuffer,
        ),
        gradientDefIdBuffer: dependencies.describeBufferForDebug(
          readLegacyColorCycleTopLevelBuffers(layer.colorCycleData).gradientDefIdBuffer,
        ),
      },
    });
    const savedBrushStateForWarmup = dependencies.getSavedColorCycleBrushState(layer);
    if (savedBrushStateForWarmup && !layer.colorCycleData.brushState) {
      layer.colorCycleData.brushState = savedBrushStateForWarmup;
    }
    const warmupWidth = layer.colorCycleData.canvasWidth ?? layer.imageData?.width ?? layer.framebuffer.width ?? 1;
    const warmupHeight = layer.colorCycleData.canvasHeight ?? layer.imageData?.height ?? layer.framebuffer.height ?? 1;
    const warmupDocumentState = normalizeColorCycleLayerDocumentState(layer, {
      fallbackWidth: warmupWidth,
      fallbackHeight: warmupHeight,
      decodeSerializedBrushStateBuffers: shouldValidateWarmupPrimaryPayload,
    });
    const existingWarmupDocument = manager.getDocument(layer.id);
    const existingWarmupDocumentRead = typeof existingWarmupDocument?.read === 'function'
      ? existingWarmupDocument.read()
      : null;
    if (existingWarmupDocumentRead) {
      dependencies.debug.log('canonical-warmup-existing-document-read', {
        layerId: layer.id,
        documentVersion: existingWarmupDocumentRead.version,
        hasPaintBuffer: Boolean(existingWarmupDocumentRead.snapshot.paintBuffer),
      });
    }
    const warmupDocument = warmupDocumentState.ok
      ? {
	          read: () => ({
	            snapshot: warmupDocumentState.state,
	            version: existingWarmupDocumentRead?.version ?? 0,
	            pixelVersion: existingWarmupDocumentRead?.pixelVersion ?? existingWarmupDocumentRead?.version ?? 0,
	          }),
        }
      : existingWarmupDocument;
    const warmupSnapshot = captureColorCyclePersistenceSnapshot(layer, {
      projectWidth: warmupWidth,
      projectHeight: warmupHeight,
      requirePaint: true,
      mode: 'diagnostic',
      document: warmupDocument,
      runtimeBrush: null,
      serializeRuntimeBrushState: dependencies.serializeRuntimeBrushState,
      diagnostics: (diagnostic) => {
        dependencies.debug.log('canonical-payload-diagnostic', {
          layerId: layer.id,
          ...diagnostic,
        });
      },
    });
    if (
      !warmupSnapshot.ok &&
      shouldValidateWarmupPrimaryPayload &&
      hasRecoverableColorCycleRuntimeSource(layer) &&
      dependencies.isPrimaryColorCyclePayloadFailure(warmupSnapshot.reason)
    ) {
      const before = summarizeColorCycleLayer(layer);
      layer.colorCycleData = {
        ...setColorCycleHydrationState(layer.colorCycleData, 'cold'),
        deferredRuntimeRestore: false,
        repairStatus: layer.colorCycleData.repairStatus ?? {
          ok: false,
          reason: dependencies.toRepairStatusReasonForPrimaryPayloadFailure(warmupSnapshot.reason),
          notes: dependencies.withColorCycleDiagnosticNotes(
            ['color-cycle-runtime-restore-primary-payload-drop-blocked'],
            ['static-preview-only', 'repair-failed'],
          ),
        },
      };
      ensureLayerDocumentResidency(layer, 'static-preview-only');
      dependencies.debug.warn('cc-warmup-canonical-payload-drop-blocked', {
        layerId: layer.id,
        reason: warmupSnapshot.reason,
        damageKind: warmupSnapshot.damageKind,
        diagnostics: warmupSnapshot.diagnostics,
      });
      logCCMutation({
        event: 'cc-warmup-canonical-payload-drop-blocked',
        layerId: layer.id,
        reason: 'restoreColorCycleBrushes',
        severity: 'error',
        before,
        after: summarizeColorCycleLayer(layer),
        details: {
          snapshotReason: warmupSnapshot.reason,
          damageKind: warmupSnapshot.damageKind ?? null,
          diagnostics: warmupSnapshot.diagnostics,
        },
      });
      continue;
    }

    layer.colorCycleData = setColorCycleHydrationState(layer.colorCycleData, targetRuntimeState);
    const restored = await dependencies.restoreLayerRuntimeForMaterialization(
      layer,
      createColorCycleBrushForRestore,
      canSeedFromPersistedBuffers,
      hadLazyArchiveRuntime
        ? {
            preserveVersion: true,
            clearAudit: false,
          }
        : undefined,
    );
    if (!restored.brush) {
      layer.colorCycleData = {
        ...setColorCycleHydrationState(layer.colorCycleData, 'cold'),
        deferredRuntimeRestore: false,
      };
      ensureLayerDocumentResidency(layer, 'static-preview-only');
      if (
        restored.reason === 'missing-paint-buffer' &&
        layer.colorCycleData &&
        !layer.colorCycleData.repairStatus
      ) {
        layer.colorCycleData.repairStatus = {
          ok: false,
          reason: 'missing-paint-buffer',
          notes: dependencies.withColorCycleDiagnosticNotes(
            ['color-cycle-runtime-restore-missing-canonical-paint'],
            ['static-preview-only', 'repair-failed'],
          ),
        };
      }
      dependencies.debug.warn('runtime-restore-missing-brush', {
        layerId: layer.id,
        targetRuntimeState,
        reason: restored.reason,
        documentVersion: restored.documentVersion ?? null,
      });
    } else {
      dependencies.debug.log('runtime-restore-complete', {
        layerId: layer.id,
        targetRuntimeState,
        hydration: getColorCycleHydrationState(layer.colorCycleData),
        materialized: restored.materialized,
        documentVersion: restored.documentVersion ?? null,
      });
    }
  }

  return layers;
};
