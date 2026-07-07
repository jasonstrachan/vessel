import type {
  ColorCycleLayerDocument,
  ColorCycleLayerDocumentState,
} from '@/lib/colorCycle/document';
import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { Layer } from '@/types';

import { layerStrokeStateHasContent } from './colorCycleLayerStrokeBuffers';
import {
  resolveColorCycleLayerMeta,
  type ColorCycleLayerMetaRuntimeContext,
} from './colorCycleLayerMetaRuntime';
import {
  getColorCycleRuntimeLayerDocument,
  getColorCycleRuntimeLayerId,
  bindColorCycleRuntimeLayerStrokeBuffersToAnimator,
  clearColorCycleRuntimeLayerStrokeStatesForReset,
  ensureColorCycleRuntimeLayerStrokeState,
  mutateColorCycleRuntimeLayerStrokeState,
  rebaseColorCycleRuntimeLayerDocument,
  removeColorCycleRuntimeLayerDocument,
  setColorCycleRuntimeActiveLayerId,
  setColorCycleRuntimeIsolated,
  setColorCycleRuntimeLayerDocument,
  setColorCycleRuntimeLayerId,
  setColorCycleRuntimeLayerStrokeState,
  snapshotColorCycleRuntimeLayerStrokeStateFromBuffers,
  type ColorCycleLayerStrokeStateMutationParams,
  type ColorCycleLayerDocumentRuntimeContext,
} from './colorCycleLayerDocumentRuntime';
import { ColorCycleLayerBindingState } from './colorCycleLayerBindingState';
import { ColorCycleRuntimeDocumentState } from './colorCycleRuntimeDocumentState';
import {
  createColorCyclePaintPatchApplyRuntime,
  type ColorCyclePaintPatchApplyRuntimeContext,
} from './colorCyclePaintPatchApplyRuntime';
import {
  createColorCycleLayerSnapshotRegistrationRuntime,
  createColorCycleSerializedStateRegistrationRuntime,
  type ColorCycleLayerSnapshotRegistrationContext,
  type ColorCycleSerializedStateRegistrationContext,
} from './colorCyclePersistenceRegistrationRuntime';
import {
  markColorCycleLayerHasExternalBase,
  type ColorCycleExternalBaseContext,
} from './colorCycleStrokeStateRuntime';
import type {
  ColorCycleRuntimeMutationReason,
  LayerStrokeState,
  SerializedLayerColorCycleMeta,
} from './colorCycleCanvas2DTypes';

type RuntimeDocumentState = ColorCycleRuntimeDocumentState<LayerStrokeState>;

type ColorCycleLayerDocumentDerivedSurface = {
  builtFromVersion: number | null;
  rebuild(snapshot: ReturnType<ColorCycleLayerDocument['read']>['snapshot'], version: number): void;
};

export type ColorCycleLayerDocumentApiRuntimeDeps = {
  getCanvasWidth(): number;
  getCanvasHeight(): number;
  getLayers(): Layer[];
  getLayerBaseSpeedCps(): number;
  getResolvedWriteCycleSpeed(): number;
  getFlowMode(): ColorCycleLayerDocumentState['flowMode'];
  hasStrokeContent?(strokeData: LayerStrokeState): boolean;
  getDerivedSurface(layerId: string): ColorCycleLayerDocumentDerivedSurface | null | undefined;
  markLayerDirty(layerId: string): void;
};

export type ColorCycleLayerDocumentPersistenceRuntimeContext =
  ColorCycleSerializedStateRegistrationContext &
  ColorCycleLayerSnapshotRegistrationContext & {
    ensureAnimator(layerId: string): ColorCycleAnimator;
  };

export class ColorCycleLayerDocumentApiRuntime {
  private readonly layerBindingState = new ColorCycleLayerBindingState();
  private readonly runtimeDocuments = new ColorCycleRuntimeDocumentState<LayerStrokeState>();

  constructor(
    private readonly deps: ColorCycleLayerDocumentApiRuntimeDeps,
  ) {}

  get owner(): object {
    return this.runtimeDocuments.owner;
  }

  private readonly registerSerializedStateRuntime = (
    runtime: Parameters<RuntimeDocumentState['registerSerializedStateRuntime']>[0],
  ): void => {
    this.runtimeDocuments.registerSerializedStateRuntime(runtime);
  };

  private readonly registerLayerSnapshotRuntime = (
    runtime: Parameters<RuntimeDocumentState['registerLayerSnapshotRuntime']>[0],
  ): void => {
    this.runtimeDocuments.registerLayerSnapshotRuntime(runtime);
  };

  private readonly registerPaintPatchRuntime = (
    runtime: Parameters<RuntimeDocumentState['registerPaintPatchRuntime']>[0],
  ): void => {
    this.runtimeDocuments.registerPaintPatchRuntime(runtime);
  };

  readonly registerSerializedStateContext = (
    context: ColorCycleSerializedStateRegistrationContext,
  ): void => {
    this.registerSerializedStateRuntime(
      createColorCycleSerializedStateRegistrationRuntime(context),
    );
  };

  readonly registerLayerSnapshotContext = (
    context: ColorCycleLayerSnapshotRegistrationContext,
  ): void => {
    this.registerLayerSnapshotRuntime(
      createColorCycleLayerSnapshotRegistrationRuntime(context),
    );
  };

  readonly registerPaintPatchContext = (
    context: ColorCyclePaintPatchApplyRuntimeContext,
  ): void => {
    this.registerPaintPatchRuntime(
      createColorCyclePaintPatchApplyRuntime(context),
    );
  };

  readonly registerPersistenceContexts = (
    context: ColorCycleLayerDocumentPersistenceRuntimeContext,
  ): void => {
    this.registerLayerSnapshotContext({
      applyLayerSnapshot: (layerId, snapshot, animatorIndex, reason, options) => {
        context.applyLayerSnapshot(layerId, snapshot, animatorIndex, reason, options);
      },
    });
    this.registerPaintPatchContext({
      getCanvasWidth: () => this.deps.getCanvasWidth(),
      getCanvasHeight: () => this.deps.getCanvasHeight(),
      ensureStrokeState: (layerId) => ensureColorCycleRuntimeLayerStrokeState(this.getContext(), layerId),
      ensureAnimator: (layerId) => context.ensureAnimator(layerId),
      bindStrokeBuffersToAnimator: (strokeState, animator) => {
        bindColorCycleRuntimeLayerStrokeBuffersToAnimator(this.getContext(), strokeState, animator);
      },
      publishStrokeState: (layerId, strokeState, publish) => {
        this.setRuntimeLayerStrokeState(layerId, strokeState, {
          publishToDocument: true,
          reason: publish.reason,
        });
      },
      snapshotFromBuffers: (strokeState) => this.snapshotFromBuffers(strokeState),
      markLayerDirty: (layerId) => this.deps.markLayerDirty(layerId),
    });
    this.registerSerializedStateContext({
      readSerializedState: () => context.readSerializedState(),
      restoreSerializedState: (state, options) => context.restoreSerializedState(state, options),
    });
  };

  readonly getStrokeState = (layerId: string): LayerStrokeState | undefined => (
    this.runtimeDocuments.getStrokeState(layerId)
  );

  readonly ensureStrokeState = (
    layerId: string,
    createStrokeState: () => LayerStrokeState,
  ): LayerStrokeState => (
    this.runtimeDocuments.ensureStrokeState(layerId, createStrokeState)
  );

  readonly getStrokeStateEntries = (): Array<[string, LayerStrokeState]> => (
    this.runtimeDocuments.getStrokeStateEntries()
  );

  readonly getStrokeStateValues = (): LayerStrokeState[] => (
    this.runtimeDocuments.getStrokeStateValues()
  );

  readonly hasStrokeState = (layerId: string): boolean => (
    this.runtimeDocuments.hasStrokeState(layerId)
  );

  readonly setStrokeState = (layerId: string, strokeState: LayerStrokeState): void => {
    this.runtimeDocuments.setStrokeState(layerId, strokeState);
  };

  readonly setRuntimeLayerStrokeState = (
    layerId: string,
    strokeState: LayerStrokeState,
    options?: { publishToDocument?: boolean; reason?: ColorCycleRuntimeMutationReason },
  ): void => {
    setColorCycleRuntimeLayerStrokeState(this.getContext(), layerId, strokeState, options);
  };

  readonly mutateRuntimeLayerStrokeState = (
    params: ColorCycleLayerStrokeStateMutationParams,
  ): LayerStrokeState => (
    mutateColorCycleRuntimeLayerStrokeState(this.getContext(), params)
  );

  readonly clearRuntimeLayerStrokeStatesForReset = (
    reason: ColorCycleRuntimeMutationReason,
  ): void => {
    clearColorCycleRuntimeLayerStrokeStatesForReset(this.getContext(), reason);
  };

  readonly snapshotFromBuffers = (strokeState: LayerStrokeState): void => {
    snapshotColorCycleRuntimeLayerStrokeStateFromBuffers(this.getContext(), strokeState);
  };

  readonly setStrokeStateWithDocumentPublish = (
    params: Parameters<RuntimeDocumentState['setStrokeStateWithDocumentPublish']>[0],
  ): void => {
    this.runtimeDocuments.setStrokeStateWithDocumentPublish(params);
  };

  readonly mutateStrokeState = (
    params: Parameters<RuntimeDocumentState['mutateStrokeState']>[0],
  ): LayerStrokeState => (
    this.runtimeDocuments.mutateStrokeState(params)
  );

  readonly buildDocumentStateFromStrokeState = (
    params: Parameters<RuntimeDocumentState['buildDocumentStateFromStrokeState']>[0],
  ) => (
    this.runtimeDocuments.buildDocumentStateFromStrokeState(params)
  );

  readonly buildEmptyDocumentState = (
    params: Parameters<RuntimeDocumentState['buildEmptyDocumentState']>[0],
  ) => (
    this.runtimeDocuments.buildEmptyDocumentState(params)
  );

  readonly clearStrokeStatesForReset = (
    params: Parameters<RuntimeDocumentState['clearStrokeStatesForReset']>[0],
  ): void => {
    this.runtimeDocuments.clearStrokeStatesForReset(params);
  };

  readonly ensureLayerDocument = (
    layerId: string,
    buildInitialState: Parameters<RuntimeDocumentState['ensureLayerDocument']>[1],
  ): ColorCycleLayerDocument => (
    this.runtimeDocuments.ensureLayerDocument(layerId, buildInitialState)
  );

  readonly setLayerDocument = (
    layerId: string,
    document: ColorCycleLayerDocument,
  ): void => {
    this.runtimeDocuments.setLayerDocument(layerId, document);
  };

  readonly getLayerDocument = (layerId: string): ColorCycleLayerDocument | undefined => (
    this.runtimeDocuments.getLayerDocument(layerId)
  );

  readonly rebaseLayerDocument = (
    params: Parameters<RuntimeDocumentState['rebaseLayerDocument']>[0],
  ): void => {
    this.runtimeDocuments.rebaseLayerDocument(params);
  };

  readonly deleteLayerDocument = (layerId: string): void => {
    this.runtimeDocuments.deleteLayerDocument(layerId);
  };

  readonly getLayerDocumentRead = (
    layerId: string,
  ): ReturnType<ColorCycleLayerDocument['read']> | undefined => (
    this.runtimeDocuments.getLayerDocumentRead(layerId)
  );

  readonly getLayerDocumentVersion = (layerId: string): number | null => (
    this.runtimeDocuments.getLayerDocumentVersion(layerId)
  );

  readonly consumeLayerDirtyBatch = (
    layerId: string,
  ): ReturnType<ColorCycleLayerDocument['consumeDirtyBatch']> | undefined => (
    this.runtimeDocuments.consumeLayerDirtyBatch(layerId)
  );

  readonly mergeLayerMeta = (
    layerId: string,
    fallback: Parameters<RuntimeDocumentState['mergeLayerMeta']>[1],
  ) => (
    this.runtimeDocuments.mergeLayerMeta(layerId, fallback)
  );

  readonly setLayerMeta = (
    layerId: string,
    meta: Parameters<RuntimeDocumentState['setLayerMeta']>[1],
  ): void => {
    this.runtimeDocuments.setLayerMeta(layerId, meta);
  };

  readonly captureMutationAuditSnapshot = (
    params: Parameters<RuntimeDocumentState['captureMutationAuditSnapshot']>[0],
  ) => (
    this.runtimeDocuments.captureMutationAuditSnapshot(params)
  );

  readonly recordMutationIfCleared = (
    params: Parameters<RuntimeDocumentState['recordMutationIfCleared']>[0],
  ): void => {
    this.runtimeDocuments.recordMutationIfCleared(params);
  };

  readonly getLayerColorCycleMeta = (layerId: string): SerializedLayerColorCycleMeta | null => (
    resolveColorCycleLayerMeta(this.getLayerMetaRuntimeContext(), layerId)
  );

  readonly markLayerHasExternalBase = (layerId: string): void => {
    markColorCycleLayerHasExternalBase(this.getExternalBaseContext(), layerId);
  };

  readonly clearAll = (): void => {
    this.runtimeDocuments.clearAll();
  };

  readonly setLayerBindingLayerId = (layerId: string): void => {
    this.layerBindingState.setLayerId(layerId);
  };

  readonly getLayerBindingLayerId = (): string | null => (
    this.layerBindingState.getLayerId()
  );

  readonly setLayerBindingIsolated = (isolated: boolean): void => {
    this.layerBindingState.setIsolated(isolated);
  };

  readonly getActiveLayerId = (): string | null => (
    this.layerBindingState.getActiveLayerId()
  );

  readonly setActiveLayerId = (layerId: string): void => {
    this.layerBindingState.setActiveLayerId(layerId);
  };

  readonly setActiveLayer = (layerId: string): void => {
    setColorCycleRuntimeActiveLayerId(this.getContext(), layerId);
  };

  readonly setLayerId = (layerId: string): void => {
    setColorCycleRuntimeLayerId(this.getContext(), layerId);
  };

  readonly setColorCycleLayerDocument = (
    layerId: string,
    document: ColorCycleLayerDocument,
  ): void => {
    setColorCycleRuntimeLayerDocument(this.getContext(), layerId, document);
  };

  readonly getColorCycleLayerDocument = (
    layerId: string,
  ): ColorCycleLayerDocument | undefined => (
    getColorCycleRuntimeLayerDocument(this.getContext(), layerId)
  );

  readonly rebaseColorCycleLayerDocument = (
    layerId: string,
    options: {
      preserveVersion?: boolean;
      clearAudit?: boolean;
    } = {},
  ): void => {
    rebaseColorCycleRuntimeLayerDocument(this.getContext(), layerId, options);
  };

  readonly removeColorCycleLayerDocument = (layerId: string): void => {
    removeColorCycleRuntimeLayerDocument(this.getContext(), layerId);
  };

  readonly getLayerId = (): string | null => (
    getColorCycleRuntimeLayerId(this.getContext())
  );

  readonly setIsolated = (isolated: boolean): void => {
    setColorCycleRuntimeIsolated(this.getContext(), isolated);
  };

  readonly getRuntimeContext = (): ColorCycleLayerDocumentRuntimeContext => (
    this.getContext()
  );

  private getContext(): ColorCycleLayerDocumentRuntimeContext {
    return {
      setLayerId: (layerId) => this.setLayerBindingLayerId(layerId),
      getLayerId: () => this.getLayerBindingLayerId(),
      setIsolated: (isolated) => this.setLayerBindingIsolated(isolated),
      ensureLayerDocument: (layerId, buildInitialState) =>
        this.ensureLayerDocument(layerId, buildInitialState),
      setLayerDocument: (layerId, document) => this.setLayerDocument(layerId, document),
      getLayerDocument: (layerId) => this.getLayerDocument(layerId),
      rebaseLayerDocument: (params) => this.rebaseLayerDocument(params),
      deleteLayerDocument: (layerId) => this.deleteLayerDocument(layerId),
      getStrokeState: (layerId) => this.getStrokeState(layerId),
      ensureStrokeState: (layerId, createStrokeState) =>
        this.ensureStrokeState(layerId, createStrokeState),
      buildDocumentStateFromStrokeState: (params) =>
        this.buildDocumentStateFromStrokeState(params),
      buildEmptyDocumentState: (params) => this.buildEmptyDocumentState(params),
      setStrokeStateWithDocumentPublish: (params) =>
        this.setStrokeStateWithDocumentPublish(params),
      mutateStrokeState: (params) => this.mutateStrokeState(params),
      clearStrokeStatesForReset: (params) => this.clearStrokeStatesForReset(params),
      getCanvasWidth: () => this.deps.getCanvasWidth(),
      getCanvasHeight: () => this.deps.getCanvasHeight(),
      getLayerMeta: (layerId) => this.getLayerColorCycleMeta(layerId),
      getLayerBaseSpeedCps: () => this.deps.getLayerBaseSpeedCps(),
      getResolvedWriteCycleSpeed: () => this.deps.getResolvedWriteCycleSpeed(),
      getFlowMode: () => this.deps.getFlowMode(),
      hasStrokeContent: (strokeData) => (
        this.deps.hasStrokeContent?.(strokeData)
        ?? layerStrokeStateHasContent(
          strokeData,
          this.deps.getCanvasWidth(),
          this.deps.getCanvasHeight(),
        )
      ),
      getDerivedSurface: (layerId) => this.deps.getDerivedSurface(layerId),
      markLayerDirty: (layerId) => this.deps.markLayerDirty(layerId),
    };
  }

  private getLayerMetaRuntimeContext(): ColorCycleLayerMetaRuntimeContext {
    return {
      getLayers: () => this.deps.getLayers(),
      mergeLayerMeta: (layerId, fallback) => this.mergeLayerMeta(layerId, fallback),
    };
  }

  private getExternalBaseContext(): ColorCycleExternalBaseContext {
    return {
      ensureStrokeState: (layerId) => ensureColorCycleRuntimeLayerStrokeState(this.getContext(), layerId),
      setStrokeState: (layerId, strokeData) => this.setStrokeState(layerId, strokeData),
    };
  }
}
