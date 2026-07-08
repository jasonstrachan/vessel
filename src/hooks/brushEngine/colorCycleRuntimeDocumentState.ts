import {
  logCCMutation,
  summarizeScalarBuffer,
  summarizeSerializedColorCycleLayer,
} from '@/utils/colorCycle/ccMutationAudit';
import { strokeFinalizeProbeTimeSync } from '@/utils/strokeFinalizeProbe';
import type {
  ColorCycleRuntimeMutationAuditSnapshot,
  ColorCycleRuntimeMutationReason,
  ColorCycleRuntimeMutationSource,
  SerializedLayerColorCycleMeta,
} from './colorCycleCanvas2DTypes';
import {
  clearColorCycleBrushPersistenceLayerMetaForOwner,
  clearColorCycleBrushStrokeStatesForOwner,
  clearColorCycleLayerDocumentsForOwner,
  ColorCycleLayerDocument,
  createColorCycleLayerDocumentStateFromStrokeState,
  createEmptyColorCycleLayerDocumentState,
  deleteColorCycleLayerDocumentForOwner,
  getColorCycleBrushStrokeStateEntriesForOwner,
  getColorCycleBrushStrokeStateForOwner,
  getColorCycleBrushStrokeStateValuesForOwner,
  getColorCycleLayerDocumentForOwner,
  hasColorCycleBrushStrokeStateForOwner,
  hasColorCycleLayerDocumentForOwner,
  mergeColorCycleBrushPersistenceLayerMetaForOwner,
  registerColorCycleBrushLayerSnapshotRuntime,
  registerColorCycleBrushPaintPatchRuntime,
  registerColorCycleBrushSerializedStateRuntime,
  setColorCycleBrushPersistenceLayerMeta,
  setColorCycleBrushStrokeStateForOwner,
  setColorCycleLayerDocumentForOwner,
  type ColorCycleBrushPersistenceLayerMeta,
  type ColorCycleBrushPersistenceStrokeState,
  type ColorCycleDirtyRect,
  type ColorCycleLayerDocumentState,
  isDerivedSurfaceStale,
} from '@/lib/colorCycle/document';

type SerializedStateRuntime = Parameters<typeof registerColorCycleBrushSerializedStateRuntime>[1];
type LayerSnapshotRuntime = Parameters<typeof registerColorCycleBrushLayerSnapshotRuntime>[1];
type PaintPatchRuntime = Parameters<typeof registerColorCycleBrushPaintPatchRuntime>[1];
type RebuildableDerivedSurface = {
  builtFromVersion: number | null;
  rebuild(snapshot: ReturnType<ColorCycleLayerDocument['read']>['snapshot'], version: number): void;
};
type MutableRuntimeStrokeState = ColorCycleBrushPersistenceStrokeState & {
  contentIsOptimistic?: boolean;
};

export class ColorCycleRuntimeDocumentState<StrokeState extends ColorCycleBrushPersistenceStrokeState> {
  private readonly runtimeOwner = {};

  get owner(): object {
    return this.runtimeOwner;
  }

  registerSerializedStateRuntime(runtime: SerializedStateRuntime): void {
    registerColorCycleBrushSerializedStateRuntime(this.runtimeOwner, runtime);
  }

  registerLayerSnapshotRuntime(runtime: LayerSnapshotRuntime): void {
    registerColorCycleBrushLayerSnapshotRuntime(this.runtimeOwner, runtime);
  }

  registerPaintPatchRuntime(runtime: PaintPatchRuntime): void {
    registerColorCycleBrushPaintPatchRuntime(this.runtimeOwner, runtime);
  }

  getStrokeState(layerId: string): StrokeState | undefined {
    return getColorCycleBrushStrokeStateForOwner<StrokeState>(this.runtimeOwner, layerId);
  }

  ensureStrokeState(layerId: string, createStrokeState: () => StrokeState): StrokeState {
    const existing = this.getStrokeState(layerId);
    if (existing) {
      return existing;
    }
    const strokeState = createStrokeState();
    this.setStrokeState(layerId, strokeState);
    return strokeState;
  }

  getStrokeStateEntries(): Array<[string, StrokeState]> {
    return Array.from(getColorCycleBrushStrokeStateEntriesForOwner<StrokeState>(this.runtimeOwner));
  }

  getStrokeStateValues(): StrokeState[] {
    return Array.from(getColorCycleBrushStrokeStateValuesForOwner<StrokeState>(this.runtimeOwner));
  }

  hasStrokeState(layerId: string): boolean {
    return hasColorCycleBrushStrokeStateForOwner(this.runtimeOwner, layerId);
  }

  setStrokeState(layerId: string, strokeState: StrokeState): void {
    setColorCycleBrushStrokeStateForOwner(this.runtimeOwner, layerId, strokeState);
  }

  setStrokeStateWithDocumentPublish(params: {
    layerId: string;
    strokeState: StrokeState;
    publishToDocument?: boolean;
    reason?: string;
    buildDocumentState: () => ColorCycleLayerDocumentState;
    forceDocumentPublish?: boolean;
    pixelsChanged?: boolean;
    dirtyRects?: ColorCycleDirtyRect[];
    takeDocumentStateOwnership?: boolean;
    assumeDerivedSurfaceCurrent?: boolean;
    derivedSurface?: RebuildableDerivedSurface | null;
  }): void {
    strokeFinalizeProbeTimeSync(
      'colorCycleRuntimeDocumentState:setStrokeState',
      () => this.setStrokeState(params.layerId, params.strokeState),
      { layerId: params.layerId, reason: params.reason ?? 'snapshot-apply' }
    );
    if (!params.publishToDocument) {
      return;
    }

    const document = strokeFinalizeProbeTimeSync(
      'colorCycleRuntimeDocumentState:getLayerDocument',
      () => this.getLayerDocument(params.layerId),
      { layerId: params.layerId, reason: params.reason ?? 'snapshot-apply' }
    );
    if (!document) {
      return;
    }

    const reason = params.reason ?? 'snapshot-apply';
    const read = strokeFinalizeProbeTimeSync(
      'colorCycleRuntimeDocumentState:replaceDocumentState',
      () => document.replaceState(
        params.buildDocumentState(),
        reason,
        {
          force: params.forceDocumentPublish,
          pixelsChanged: params.pixelsChanged,
          dirtyRects: params.dirtyRects,
          takeOwnership: params.takeDocumentStateOwnership,
        }
      ),
      { layerId: params.layerId, reason }
    );
    const derivedSurface = params.derivedSurface;
    if (derivedSurface) {
      const isStale = strokeFinalizeProbeTimeSync(
        'colorCycleRuntimeDocumentState:isDerivedSurfaceStale',
        () => isDerivedSurfaceStale(document, derivedSurface),
        { layerId: params.layerId, reason, assumeDerivedSurfaceCurrent: params.assumeDerivedSurfaceCurrent === true }
      );
      if (isStale && params.assumeDerivedSurfaceCurrent === true) {
        strokeFinalizeProbeTimeSync(
          'colorCycleRuntimeDocumentState:markDerivedSurfaceCurrent',
          () => {
            derivedSurface.builtFromVersion = read.version;
          },
          { layerId: params.layerId, reason, version: read.version }
        );
      } else if (isStale) {
        strokeFinalizeProbeTimeSync(
          'colorCycleRuntimeDocumentState:rebuildDerivedSurface',
          () => derivedSurface.rebuild(read.snapshot, read.version),
          { layerId: params.layerId, reason, version: read.version }
        );
      }
    }
  }

  mutateStrokeState(params: {
    layerId: string;
    reason: ColorCycleRuntimeMutationReason;
    source: ColorCycleRuntimeMutationSource;
    expectedDestructive?: boolean;
    mutate: (strokeState: StrokeState) => void;
    after?: {
      hasContent?: boolean;
      strokeCounter?: number;
    };
    markDirty?: boolean;
    createStrokeState: () => StrokeState;
    width: number;
    height: number;
    getMeta: () => SerializedLayerColorCycleMeta | null;
    buildDocumentState: (strokeState: StrokeState) => ColorCycleLayerDocumentState;
    forceDocumentPublish?: boolean;
    pixelsChanged?: boolean;
    dirtyRects?: ColorCycleDirtyRect[];
    takeDocumentStateOwnership?: boolean;
    assumeDerivedSurfaceCurrent?: boolean;
    derivedSurface?: RebuildableDerivedSurface | null;
    markLayerDirty?: (layerId: string) => void;
  }): StrokeState {
    const strokeState = this.ensureStrokeState(
      params.layerId,
      params.createStrokeState,
    );
    const shouldAuditPotentialClear = params.after?.hasContent !== true;
    const before = shouldAuditPotentialClear
      ? strokeFinalizeProbeTimeSync(
          'colorCycleRuntimeDocumentState:captureMutationBefore',
          () => this.captureMutationAuditSnapshot({
            layerId: params.layerId,
            strokeData: strokeState,
            width: params.width,
            height: params.height,
            meta: params.getMeta(),
          }),
          { layerId: params.layerId, reason: params.reason }
        )
      : null;

    strokeFinalizeProbeTimeSync(
      'colorCycleRuntimeDocumentState:mutateStrokeState',
      () => params.mutate(strokeState),
      { layerId: params.layerId, reason: params.reason }
    );

    if (typeof params.after?.hasContent === 'boolean') {
      strokeState.hasContent = params.after.hasContent;
      if (!params.after.hasContent) {
        (strokeState as MutableRuntimeStrokeState).contentIsOptimistic = false;
      }
    }
    if (typeof params.after?.strokeCounter === 'number') {
      strokeState.strokeCounter = params.after.strokeCounter;
    }

    strokeFinalizeProbeTimeSync(
      'colorCycleRuntimeDocumentState:setStrokeStateWithDocumentPublish',
      () => this.setStrokeStateWithDocumentPublish({
        layerId: params.layerId,
        strokeState,
        publishToDocument: true,
        reason: params.reason,
        buildDocumentState: () => strokeFinalizeProbeTimeSync(
          'colorCycleRuntimeDocumentState:buildDocumentState',
          () => params.buildDocumentState(strokeState),
          { layerId: params.layerId, reason: params.reason }
        ),
        forceDocumentPublish: params.forceDocumentPublish,
        pixelsChanged: params.pixelsChanged,
        dirtyRects: params.dirtyRects,
        takeDocumentStateOwnership: params.takeDocumentStateOwnership,
        assumeDerivedSurfaceCurrent: params.assumeDerivedSurfaceCurrent,
        derivedSurface: params.derivedSurface,
      }),
      { layerId: params.layerId, reason: params.reason }
    );
    if (params.markDirty !== false) {
      strokeFinalizeProbeTimeSync(
        'colorCycleRuntimeDocumentState:markLayerDirty',
        () => params.markLayerDirty?.(params.layerId),
        { layerId: params.layerId, reason: params.reason }
      );
    }

    if (shouldAuditPotentialClear) {
      const after = strokeFinalizeProbeTimeSync(
        'colorCycleRuntimeDocumentState:captureMutationAfter',
        () => this.captureMutationAuditSnapshot({
          layerId: params.layerId,
          strokeData: strokeState,
          width: params.width,
          height: params.height,
          meta: params.getMeta(),
        }),
        { layerId: params.layerId, reason: params.reason }
      );
      strokeFinalizeProbeTimeSync(
        'colorCycleRuntimeDocumentState:recordMutationIfCleared',
        () => this.recordMutationIfCleared({
          layerId: params.layerId,
          reason: params.reason,
          source: params.source,
          expectedDestructive: params.expectedDestructive,
          before,
          after,
        }),
        { layerId: params.layerId, reason: params.reason }
      );
    }

    return strokeState;
  }

  buildDocumentStateFromStrokeState(params: {
    layerId: string;
    strokeState: StrokeState;
    width: number;
    height: number;
    meta: ColorCycleBrushPersistenceLayerMeta | null;
    layerBaseSpeedCps: number;
    flowMode: ColorCycleLayerDocumentState['flowMode'];
    hasStrokeContent: (strokeState: StrokeState) => boolean;
  }): ColorCycleLayerDocumentState {
    return createColorCycleLayerDocumentStateFromStrokeState({
      layerId: params.layerId,
      width: params.width,
      height: params.height,
      strokeState: params.strokeState,
      meta: params.meta,
      layerBaseSpeedCps: params.layerBaseSpeedCps,
      flowMode: params.flowMode,
      hasStrokeContent: (strokeState) => params.hasStrokeContent(strokeState as StrokeState),
    });
  }

  buildEmptyDocumentState(params: {
    layerId: string;
    width: number;
    height: number;
  }): ColorCycleLayerDocumentState {
    return createEmptyColorCycleLayerDocumentState(params);
  }

  clearStrokeStates(): void {
    clearColorCycleBrushStrokeStatesForOwner(this.runtimeOwner);
  }

  getLayerDocument(layerId: string): ColorCycleLayerDocument | undefined {
    return getColorCycleLayerDocumentForOwner(this.runtimeOwner, layerId);
  }

  getLayerDocumentRead(layerId: string): ReturnType<ColorCycleLayerDocument['read']> | undefined {
    return this.getLayerDocument(layerId)?.read();
  }

  getLayerDocumentVersion(layerId: string): number | null {
    return this.getLayerDocument(layerId)?.read().version ?? null;
  }

  consumeLayerDirtyBatch(layerId: string): ReturnType<ColorCycleLayerDocument['consumeDirtyBatch']> | undefined {
    return this.getLayerDocument(layerId)?.consumeDirtyBatch();
  }

  hasLayerDocument(layerId: string): boolean {
    return hasColorCycleLayerDocumentForOwner(this.runtimeOwner, layerId);
  }

  ensureLayerDocument(layerId: string, buildInitialState: () => ColorCycleLayerDocumentState): ColorCycleLayerDocument {
    const existing = this.getLayerDocument(layerId);
    if (existing) {
      return existing;
    }
    const document = new ColorCycleLayerDocument(buildInitialState());
    this.setLayerDocument(layerId, document);
    return document;
  }

  setLayerDocument(layerId: string, document: ColorCycleLayerDocument): void {
    setColorCycleLayerDocumentForOwner(this.runtimeOwner, layerId, document);
  }

  deleteLayerDocument(layerId: string): void {
    deleteColorCycleLayerDocumentForOwner(this.runtimeOwner, layerId);
  }

  rebaseLayerDocument(params: {
    layerId: string;
    preserveVersion?: boolean;
    clearAudit?: boolean;
    buildState: () => ColorCycleLayerDocumentState;
  }): void {
    const document = this.getLayerDocument(params.layerId);
    if (!document) {
      return;
    }
    document.replaceBaseline(params.buildState(), {
      version: params.preserveVersion ? document.version : undefined,
      clearAudit: params.clearAudit,
    });
  }

  mergeLayerMeta(
    layerId: string,
    fallback: ColorCycleBrushPersistenceLayerMeta | null,
  ): ColorCycleBrushPersistenceLayerMeta | null {
    return mergeColorCycleBrushPersistenceLayerMetaForOwner(
      this.runtimeOwner,
      layerId,
      fallback,
    ) as ColorCycleBrushPersistenceLayerMeta | null;
  }

  setLayerMeta(layerId: string, meta: Partial<ColorCycleBrushPersistenceLayerMeta> | null): void {
    setColorCycleBrushPersistenceLayerMeta(this.runtimeOwner, layerId, meta);
  }

  captureMutationAuditSnapshot(params: {
    layerId: string;
    strokeData: StrokeState | null | undefined;
    width: number;
    height: number;
    meta: SerializedLayerColorCycleMeta | null;
  }): ColorCycleRuntimeMutationAuditSnapshot | null {
    const { layerId, strokeData, meta } = params;
    if (!strokeData) {
      return null;
    }

    const width = Math.max(1, params.width);
    const height = Math.max(1, params.height);
    const paint = summarizeScalarBuffer(strokeData.buffers.paint, width, height);
    const gradientId = summarizeScalarBuffer(strokeData.buffers.gid, width, height);
    const gradientDefId = summarizeScalarBuffer(strokeData.buffers.def, width, height);
    const speed = summarizeScalarBuffer(strokeData.buffers.spd, width, height);
    const flow = summarizeScalarBuffer(strokeData.buffers.flow, width, height);
    const phase = summarizeScalarBuffer(strokeData.buffers.phase, width, height);
    const hasContent = Boolean(strokeData.hasContent || paint.nonZeroCount > 0);

    return {
      layer: summarizeSerializedColorCycleLayer({
        layerId,
        hasContent,
        gradientDefBufferBytes: strokeData.buffers.def.byteLength,
        gradientIdBufferBytes: strokeData.buffers.gid.byteLength,
        gradientDefStoreCount: meta?.gradientDefStore?.length ?? 0,
        slotPaletteCount: meta?.slotPalettes?.length ?? 0,
      }),
      buffers: {
        paint,
        gradientId,
        gradientDefId,
        speed,
        flow,
        phase,
      },
    };
  }

  recordMutationIfCleared(params: {
    layerId: string;
    reason: ColorCycleRuntimeMutationReason;
    source: ColorCycleRuntimeMutationSource;
    expectedDestructive?: boolean;
    before: ColorCycleRuntimeMutationAuditSnapshot | null;
    after: ColorCycleRuntimeMutationAuditSnapshot | null;
  }): void {
    const beforeHadContent = Boolean(
      params.before?.layer.hasContent ||
      (params.before?.buffers.paint.nonZeroCount ?? 0) > 0,
    );
    const afterHasContent = Boolean(
      params.after?.layer.hasContent ||
      (params.after?.buffers.paint.nonZeroCount ?? 0) > 0,
    );

    if (!beforeHadContent || afterHasContent) {
      return;
    }

    logCCMutation({
      event: 'color-cycle-layer-cleared',
      layerId: params.layerId,
      reason: params.reason,
      severity: 'error',
      before: params.before?.layer ?? null,
      after: params.after?.layer ?? null,
      details: {
        source: params.source,
        expectedDestructive: params.expectedDestructive === true,
        paintBefore: params.before?.buffers.paint ?? null,
        paintAfter: params.after?.buffers.paint ?? null,
        gradientIdBefore: params.before?.buffers.gradientId ?? null,
        gradientIdAfter: params.after?.buffers.gradientId ?? null,
        gradientDefIdBefore: params.before?.buffers.gradientDefId ?? null,
        gradientDefIdAfter: params.after?.buffers.gradientDefId ?? null,
        speedBefore: params.before?.buffers.speed ?? null,
        speedAfter: params.after?.buffers.speed ?? null,
        flowBefore: params.before?.buffers.flow ?? null,
        flowAfter: params.after?.buffers.flow ?? null,
        phaseBefore: params.before?.buffers.phase ?? null,
        phaseAfter: params.after?.buffers.phase ?? null,
      },
    });
  }

  clearStrokeStatesForReset(params: {
    reason: ColorCycleRuntimeMutationReason;
    width: number;
    height: number;
    getMeta: (layerId: string) => SerializedLayerColorCycleMeta | null;
  }): void {
    for (const [layerId, strokeData] of this.getStrokeStateEntries()) {
      const before = this.captureMutationAuditSnapshot({
        layerId,
        strokeData,
        width: params.width,
        height: params.height,
        meta: params.getMeta(layerId),
      });
      const after = this.captureMutationAuditSnapshot({
        layerId,
        width: params.width,
        height: params.height,
        meta: params.getMeta(layerId),
        strokeData: {
          ...strokeData,
          hasContent: false,
          buffers: {
            paint: new Uint8Array(strokeData.buffers.paint.length),
            gid: new Uint8Array(strokeData.buffers.gid.length),
            spd: new Uint8Array(strokeData.buffers.spd.length),
            flow: new Uint8Array(strokeData.buffers.flow.length),
            phase: new Uint8Array(strokeData.buffers.phase.length),
            def: new Uint16Array(strokeData.buffers.def.length),
          },
        },
      });
      this.recordMutationIfCleared({
        layerId,
        reason: params.reason,
        source: 'reset',
        expectedDestructive: true,
        before,
        after,
      });
    }
    this.clearStrokeStates();
  }

  clearAll(): void {
    clearColorCycleBrushStrokeStatesForOwner(this.runtimeOwner);
    clearColorCycleLayerDocumentsForOwner(this.runtimeOwner);
    clearColorCycleBrushPersistenceLayerMetaForOwner(this.runtimeOwner);
  }
}
