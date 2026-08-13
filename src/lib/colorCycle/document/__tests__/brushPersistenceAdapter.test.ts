import {
  applyColorCycleBrushPaintPatchToBuffers,
  applyColorCycleBrushPaintPatchToRuntime,
  bindColorCycleCommittedGradientDefToSlot,
  applyColorCycleBrushLayerSnapshotToRuntime,
  ColorCycleBrushPersistenceMetaCache,
  canApplyColorCycleBrushLayerSnapshotToRuntime,
  canApplyColorCycleBrushPaintPatchToRuntime,
  canReadColorCycleBrushLayerSnapshotFromRuntime,
  canRestoreColorCycleBrushSerializedStateToRuntime,
  clearColorCycleBrushPersistenceLayerMetaForOwner,
  clearColorCycleBrushStrokeStatesForOwner,
  clearColorCycleBrushStrokeStateForRestore,
  colorCycleBrushSnapshotHasPaintPayload,
  commitColorCycleBrushPaintPatchResultToStrokeState,
  commitColorCycleBrushLayerSnapshotApplyResultToStrokeState,
  createColorCycleBrushDeserializeLayerApplyPlans,
  createColorCycleBrushFullStateRestorePlan,
  createColorCycleBrushSerializeSettings,
  createColorCycleBrushLayerSnapshotApplyPlan,
  createColorCycleBrushLayerSnapshotAnimatorSizingPlan,
  createColorCycleBrushLayerSnapshotBlockedAuditDetails,
  createColorCycleBrushLayerSnapshotClearAuditPlan,
  createColorCycleBrushLayerSnapshotDirtyBounds,
  createColorCycleBrushLayerSnapshotFallbackAnimationPlan,
  createColorCycleBrushLayerSnapshotMetadataPlan,
  createColorCycleBrushLayerSnapshotRestoreGuard,
  createColorCycleBrushRestoreBlockedClearAuditPlan,
  createColorCycleBrushPersistenceLayerMetaFromLayerData,
  createColorCycleLayerDocumentStateFromStrokeState,
  createColorCycleCommittedLayerStoreSyncPatch,
  createColorCycleBrushDeserializeSettingsPatch,
  createEmptyColorCycleLayerDocumentState,
  executeColorCycleCommittedLayerState,
  executeColorCycleBrushFullStateRestorePlan,
  executeColorCycleBrushLayerSnapshotAnimatorSync,
  executeColorCycleBrushLayerSnapshotMetadataPlan,
  executeColorCycleBrushLayerSnapshotRuntimeApply,
  executeColorCycleBrushPaintPatchAnimatorSync,
  executeColorCycleBrushPaintPatchRuntimeApply,
  getColorCycleBrushStrokeStateEntriesForOwner,
  getColorCycleBrushStrokeStateForOwner,
  getColorCycleBrushStrokeStateValuesForOwner,
  hasColorCycleBrushStrokeStateForOwner,
  mergeColorCycleBrushPersistenceLayerMetaForOwner,
  readColorCycleBrushLayerSnapshot,
  readColorCycleBrushLayerSnapshotFromDocumentRead,
  readColorCycleBrushLayerSnapshotFromRuntime,
  readColorCycleBrushSerializedStateFromRuntime,
  registerColorCycleBrushLayerSnapshotRuntime,
  registerColorCycleBrushPaintPatchRuntime,
  registerColorCycleBrushPersistenceOwnerAlias,
  registerColorCycleBrushSerializedStateRuntime,
  remapColorCycleCommittedGradientSlot,
  restoreColorCycleBrushSerializedStateToRuntime,
  serializeColorCycleBrushState,
  setColorCycleBrushStrokeStateForOwner,
  setColorCycleBrushPersistenceLayerMeta,
  type ColorCycleBrushLayerSnapshotMutableStrokeState,
} from '../brushPersistenceAdapter';
import { ColorCycleLayerDocument } from '../ColorCycleLayerDocument';
import {
  getColorCycleCanonicalCopyMetrics,
  resetColorCycleCanonicalCopyMetrics,
} from '../canonicalBufferAccounting';

const makeBuffers = (size: number) => ({
  paint: new Uint8Array(size),
  gid: new Uint8Array(size),
  spd: new Uint8Array(size),
  flow: new Uint8Array(size),
  phase: new Uint8Array(size),
  def: new Uint16Array(size),
});

describe('brushPersistenceAdapter', () => {
  it('reads layer snapshots from live buffers with cloned payloads', () => {
    const buffers = makeBuffers(4);
    buffers.paint.set([0, 2, 0, 4]);
    buffers.gid.set([0, 1, 0, 3]);
    const strokeState = {
      buffers,
      hasContent: false,
      strokeCounter: 7,
    };

    const snapshot = readColorCycleBrushLayerSnapshot({
      strokeState,
      hasStrokeContent: () => true,
    });

    expect(snapshot?.hasContent).toBe(true);
    expect(snapshot?.strokeCounter).toBe(7);
    expect(Array.from(new Uint8Array(snapshot?.paintBuffer ?? new ArrayBuffer(0)))).toEqual([0, 2, 0, 4]);
    buffers.paint[1] = 9;
    expect(Array.from(new Uint8Array(snapshot?.paintBuffer ?? new ArrayBuffer(0)))).toEqual([0, 2, 0, 4]);
  });

  it('reads layer snapshots from document snapshots with cloned payloads', () => {
    const paint = new Uint8Array([5, 0, 0, 0]);
    const gradientId = new Uint8Array([1, 0, 0, 0]);
    const snapshot = readColorCycleBrushLayerSnapshotFromDocumentRead({
      version: 3,
      pixelVersion: 3,
      snapshot: {
        layerId: 'layer-a',
        width: 2,
        height: 2,
        paintBuffer: paint.buffer,
        gradientIdBuffer: gradientId.buffer,
        hasContent: true,
        sources: {
          brushStateSnapshot: false,
          topLevelBuffers: false,
          legacyStateRefs: false,
        },
      },
    }, {
      fallbackStrokeCounter: 9,
    });

    expect(snapshot?.strokeCounter).toBe(9);
    expect(Array.from(new Uint8Array(snapshot?.paintBuffer ?? new ArrayBuffer(0)))).toEqual([5, 0, 0, 0]);
    expect(Array.from(new Uint8Array(snapshot?.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual([1, 0, 0, 0]);
    paint[0] = 0;
    gradientId[0] = 0;
    expect(Array.from(new Uint8Array(snapshot?.paintBuffer ?? new ArrayBuffer(0)))).toEqual([5, 0, 0, 0]);
    expect(Array.from(new Uint8Array(snapshot?.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual([1, 0, 0, 0]);
    new Uint8Array(snapshot?.paintBuffer ?? new ArrayBuffer(0))[0] = 8;
    new Uint8Array(snapshot?.gradientIdBuffer ?? new ArrayBuffer(0))[0] = 8;
    expect(Array.from(paint)).toEqual([0, 0, 0, 0]);
    expect(Array.from(gradientId)).toEqual([0, 0, 0, 0]);
    expect(readColorCycleBrushLayerSnapshotFromDocumentRead(null)).toBeNull();

    const cleared = readColorCycleBrushLayerSnapshotFromDocumentRead({
      version: 4,
      pixelVersion: 4,
      snapshot: {
        layerId: 'layer-a',
        width: 2,
        height: 2,
        paintBuffer: new Uint8Array(4).buffer,
        hasContent: false,
        sources: {
          brushStateSnapshot: true,
          topLevelBuffers: false,
          legacyStateRefs: false,
        },
      },
    });
    expect(cleared?.hasContent).toBe(false);
  });

  it('builds document state from stroke buffers with cloned metadata', () => {
    const buffers = makeBuffers(4);
    buffers.paint.set([1, 0, 0, 0]);
    buffers.gid.set([2, 0, 0, 0]);
    buffers.def.set([9, 0, 0, 0]);
    const meta = {
      slotPalettes: [{
        slot: 2,
        stops: [{ position: 0, color: '#ffffff' }],
      }],
      gradientDefStore: [{
        id: 9,
        kind: 'linear' as const,
        stops: [{ position: 0, color: '#ffffff' }],
        sourceStops: [{ position: 0, color: '#123456', opacity: 0.5 }],
        hash: 'hash',
        source: 'manual' as const,
        createdAtMs: 1,
        slot: 2,
      }],
      activeGradientId: 'active',
      paintSlot: 2,
      fgActiveSlot: 1,
    };

    const documentState = createColorCycleLayerDocumentStateFromStrokeState({
      layerId: 'layer-a',
      width: 2,
      height: 2,
      strokeState: {
        buffers,
        hasContent: true,
        strokeCounter: 3,
        flow: {
          activeSlot: 4,
          mode: 'reverse',
        },
      },
      meta,
      layerBaseSpeedCps: 0.4,
      flowMode: 'forward',
      hasStrokeContent: () => true,
    });

    expect(documentState).toMatchObject({
      layerId: 'layer-a',
      width: 2,
      height: 2,
      hasContent: true,
      activeGradientId: 'active',
      paintSlot: 2,
      fgActiveSlot: 1,
      layerBaseSpeedCps: 0.4,
      flowMode: 'reverse',
      sources: {
        brushStateSnapshot: false,
        topLevelBuffers: false,
        legacyStateRefs: false,
      },
    });
    expect(Array.from(new Uint8Array(documentState.paintBuffer ?? new ArrayBuffer(0)))).toEqual([1, 0, 0, 0]);
    expect(Array.from(new Uint8Array(documentState.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual([2, 0, 0, 0]);
    expect(Array.from(new Uint16Array(documentState.gradientDefIdBuffer ?? new ArrayBuffer(0)))).toEqual([9, 0, 0, 0]);
    expect(documentState.slotPalettes?.[0]?.stops).toEqual([{ position: 0, color: '#ffffff' }]);
    expect(documentState.gradientDefStore?.[0]?.stops).toEqual([{ position: 0, color: '#ffffff' }]);
    expect(documentState.gradientDefStore?.[0]?.sourceStops).toEqual([
      { position: 0, color: '#123456', opacity: 0.5 },
    ]);
    buffers.paint[0] = 0;
    meta.slotPalettes[0].stops[0].color = '#000000';
    meta.gradientDefStore[0].sourceStops[0].color = '#000000';
    expect(Array.from(new Uint8Array(documentState.paintBuffer ?? new ArrayBuffer(0)))).toEqual([1, 0, 0, 0]);
    expect(documentState.slotPalettes?.[0]?.stops).toEqual([{ position: 0, color: '#ffffff' }]);
    expect(documentState.gradientDefStore?.[0]?.sourceStops?.[0]?.color).toBe('#123456');
  });

  it('borrows exact runtime buffers until the document makes its one owned copy', () => {
    const buffers = makeBuffers(4);
    buffers.paint.set([1, 0, 0, 0]);
    const borrowedState = createColorCycleLayerDocumentStateFromStrokeState({
      layerId: 'layer-borrowed',
      width: 2,
      height: 2,
      strokeState: {
        buffers,
        hasContent: true,
        strokeCounter: 1,
      },
      hasStrokeContent: () => true,
      bufferOwnership: 'borrow',
    });
    expect(borrowedState.paintBuffer).toBe(buffers.paint.buffer);

    const document = new ColorCycleLayerDocument(createEmptyColorCycleLayerDocumentState({
      layerId: 'layer-borrowed',
      width: 2,
      height: 2,
    }));
    resetColorCycleCanonicalCopyMetrics();
    const published = document.replaceState(borrowedState, 'runtime-publication', {
      pixelsChanged: true,
    });

    expect(getColorCycleCanonicalCopyMetrics()).toEqual({
      totalBytes: 28,
      totalGenerations: 1,
      byReason: {
        'document-commit': { bytes: 28, generations: 1 },
      },
    });
    buffers.paint[0] = 9;
    expect(Array.from(new Uint8Array(published.snapshot.paintBuffer!))).toEqual([1, 0, 0, 0]);
  });

  it('builds empty document state with canonical zero buffers', () => {
    const documentState = createEmptyColorCycleLayerDocumentState({
      layerId: 'layer-empty',
      width: 2.9,
      height: 1.2,
    });

    expect(documentState).toMatchObject({
      layerId: 'layer-empty',
      width: 2,
      height: 1,
      hasContent: false,
      sources: {
        brushStateSnapshot: false,
        topLevelBuffers: false,
        legacyStateRefs: false,
      },
    });
    expect(new Uint8Array(documentState.paintBuffer ?? new ArrayBuffer(0))).toHaveLength(2);
    expect(new Uint8Array(documentState.gradientIdBuffer ?? new ArrayBuffer(0))).toHaveLength(2);
    expect(new Uint16Array(documentState.gradientDefIdBuffer ?? new ArrayBuffer(0))).toHaveLength(2);
    expect(new Uint8Array(documentState.speedBuffer ?? new ArrayBuffer(0))).toHaveLength(2);
    expect(new Uint8Array(documentState.flowBuffer ?? new ArrayBuffer(0))).toHaveLength(2);
    expect(new Uint8Array(documentState.phaseBuffer ?? new ArrayBuffer(0))).toHaveLength(2);
    expect(Array.from(new Uint8Array(documentState.paintBuffer ?? new ArrayBuffer(0)))).toEqual([0, 0]);
  });

  it('reads, applies, and patches through runtime compatibility facades', () => {
    const snapshot = {
      paintBuffer: new Uint8Array([1, 0]).buffer,
      hasContent: true,
      strokeCounter: 2,
    };
    const calls: string[] = [];
    const runtime = {
      getColorCycleLayerDocument: (layerId: string) => ({
        read: () => {
          calls.push(`read:${layerId}`);
          return {
            version: 1,
            pixelVersion: 1,
            snapshot: {
              layerId,
              width: 2,
              height: 1,
              paintBuffer: snapshot.paintBuffer,
              hasContent: snapshot.hasContent,
              sources: {
                brushStateSnapshot: true,
                topLevelBuffers: false,
                legacyStateRefs: false,
              },
            },
          };
        },
      }),
      getLayerSnapshot: (layerId: string) => {
        calls.push(`legacy-read:${layerId}`);
        return snapshot;
      },
    };
    registerColorCycleBrushSerializedStateRuntime(runtime, {
      read: () => {
        calls.push('serialize');
        return { source: 'serialize' };
      },
      restore: (state: unknown, options?: unknown) => {
        const source = (state as { source?: string } | null)?.source ?? 'unknown';
        calls.push(`restore:${source}:${(options as { mode?: string } | undefined)?.mode}`);
      },
    });
    registerColorCycleBrushLayerSnapshotRuntime(runtime, {
      apply: (layerId: string, nextSnapshot: typeof snapshot, _animatorIndex?: unknown, reason?: string, options?: { suppressClearAudit?: boolean }) => {
        calls.push(`apply:${layerId}:${nextSnapshot.strokeCounter}:${reason}:${options?.suppressClearAudit}`);
      },
    });
    registerColorCycleBrushPaintPatchRuntime(runtime, {
      apply: (layerId: string, roi: { width: number }, bytes: Uint8Array) => {
        calls.push(`patch:${layerId}:${roi.width}:${bytes[0]}`);
        return true;
      },
    });

    expect(new Uint8Array(
      readColorCycleBrushLayerSnapshotFromRuntime(runtime, 'layer-a')?.paintBuffer ?? new ArrayBuffer(0),
    )).toEqual(new Uint8Array([1, 0]));
    expect(readColorCycleBrushSerializedStateFromRuntime(runtime)).toEqual({ source: 'serialize' });
    expect(restoreColorCycleBrushSerializedStateToRuntime(
      runtime,
      { source: 'restore-state' },
      { mode: 'history' },
    )).toBe(true);
    expect(applyColorCycleBrushLayerSnapshotToRuntime(
      runtime,
      'layer-a',
      snapshot,
      undefined,
      'selection-region-clear',
      { suppressClearAudit: true },
    )).toBe(true);
    expect(applyColorCycleBrushPaintPatchToRuntime(
      runtime,
      'layer-a',
      { x: 0, y: 0, width: 1, height: 1 },
      new Uint8Array([7]),
    )).toBe(true);
    expect(calls).toEqual([
      'read:layer-a',
      'serialize',
      'restore:restore-state:history',
      'apply:layer-a:2:selection-region-clear:true',
      'patch:layer-a:1:7',
    ]);
    expect(readColorCycleBrushLayerSnapshotFromRuntime(null, 'layer-a')).toBeNull();
    expect(readColorCycleBrushSerializedStateFromRuntime(null)).toBeUndefined();
    expect(applyColorCycleBrushLayerSnapshotToRuntime(null, 'layer-a', snapshot)).toBe(false);
    expect(restoreColorCycleBrushSerializedStateToRuntime(null, { source: 'restore-state' })).toBe(false);
    expect(applyColorCycleBrushPaintPatchToRuntime(null, 'layer-a', { x: 0, y: 0, width: 1, height: 1 }, new Uint8Array([1]))).toBe(false);
    expect(canReadColorCycleBrushLayerSnapshotFromRuntime(runtime)).toBe(true);
    expect(canReadColorCycleBrushLayerSnapshotFromRuntime({})).toBe(false);
    expect(canRestoreColorCycleBrushSerializedStateToRuntime(runtime)).toBe(true);
    expect(canRestoreColorCycleBrushSerializedStateToRuntime({})).toBe(false);
    expect(canApplyColorCycleBrushLayerSnapshotToRuntime(runtime)).toBe(true);
    expect(canApplyColorCycleBrushLayerSnapshotToRuntime({})).toBe(false);
    expect(canApplyColorCycleBrushPaintPatchToRuntime(runtime)).toBe(true);
    expect(canApplyColorCycleBrushPaintPatchToRuntime({})).toBe(false);
  });

  it('resolves persistence calls through explicit owner aliases', () => {
    const publicOwner = {};
    const storageOwner = {};
    const strokeState = {
      buffers: makeBuffers(2),
      hasContent: true,
      strokeCounter: 5,
    };
    const snapshot = {
      paintBuffer: new Uint8Array([9, 0]).buffer,
      hasContent: true,
      strokeCounter: 6,
    };
    const calls: string[] = [];

    registerColorCycleBrushPersistenceOwnerAlias(publicOwner, storageOwner);
    setColorCycleBrushStrokeStateForOwner(storageOwner, 'layer-a', strokeState);
    setColorCycleBrushPersistenceLayerMeta(storageOwner, 'layer-a', {
      gradientDefs: [{ id: 'archive-def', currentSlot: 2 }],
      slotPalettes: [{ slot: 2, stops: [{ position: 0, color: '#000000' }] }],
      paintSlot: 2,
      activeGradientId: 'archive-def',
    });
    registerColorCycleBrushSerializedStateRuntime(storageOwner, {
      read: () => {
        calls.push('serialize');
        return { source: 'storage-owner' };
      },
      restore: () => {
        calls.push('restore');
      },
    });
    registerColorCycleBrushLayerSnapshotRuntime(storageOwner, {
      apply: (layerId: string, nextSnapshot: typeof snapshot) => {
        calls.push(`apply:${layerId}:${nextSnapshot.strokeCounter}`);
      },
    });
    registerColorCycleBrushPaintPatchRuntime(storageOwner, {
      apply: (layerId: string, roi: { width: number }, bytes: Uint8Array) => {
        calls.push(`patch:${layerId}:${roi.width}:${bytes[0]}`);
        return true;
      },
    });

    expect(hasColorCycleBrushStrokeStateForOwner(publicOwner, 'layer-a')).toBe(true);
    expect(getColorCycleBrushStrokeStateForOwner(publicOwner, 'layer-a')).toBe(strokeState);
    expect(mergeColorCycleBrushPersistenceLayerMetaForOwner(publicOwner, 'layer-a', null)?.paintSlot).toBe(2);
    expect(readColorCycleBrushSerializedStateFromRuntime(publicOwner)).toEqual({ source: 'storage-owner' });
    expect(restoreColorCycleBrushSerializedStateToRuntime(publicOwner, { source: 'restore-state' })).toBe(true);
    expect(applyColorCycleBrushLayerSnapshotToRuntime(publicOwner, 'layer-a', snapshot)).toBe(true);
    expect(applyColorCycleBrushPaintPatchToRuntime(
      publicOwner,
      'layer-a',
      { x: 0, y: 0, width: 1, height: 1 },
      new Uint8Array([7]),
    )).toBe(true);
    expect(canRestoreColorCycleBrushSerializedStateToRuntime(publicOwner)).toBe(true);
    expect(canApplyColorCycleBrushLayerSnapshotToRuntime(publicOwner)).toBe(true);
    expect(canApplyColorCycleBrushPaintPatchToRuntime(publicOwner)).toBe(true);
    expect(calls).toEqual([
      'serialize',
      'restore',
      'apply:layer-a:6',
      'patch:layer-a:1:7',
    ]);

    clearColorCycleBrushStrokeStatesForOwner(publicOwner);
    clearColorCycleBrushPersistenceLayerMetaForOwner(publicOwner);
  });

  it('reads runtime layer snapshots from the document before legacy brush snapshots', () => {
    const legacySnapshot = {
      paintBuffer: new Uint8Array([9, 9]).buffer,
      hasContent: true,
      strokeCounter: 22,
    };
    const documentPaint = new Uint8Array([1, 0]).buffer;
    const documentGradient = new Uint8Array([2, 3]).buffer;
    const documentRuntime = {
      getColorCycleLayerDocument: () => ({
        read: () => ({
          version: 7,
          pixelVersion: 7,
          snapshot: {
            layerId: 'layer-a',
            width: 2,
            height: 1,
            paintBuffer: documentPaint,
            gradientIdBuffer: documentGradient,
            hasContent: true,
            sources: {
              brushStateSnapshot: true,
              topLevelBuffers: false,
              legacyStateRefs: false,
            },
          },
        }),
      }),
      getLayerSnapshot: jest.fn(() => legacySnapshot),
    };

    const result = readColorCycleBrushLayerSnapshotFromRuntime(documentRuntime, 'layer-a');

    expect(result?.paintBuffer).not.toBe(documentPaint);
    expect(new Uint8Array(result?.paintBuffer ?? new ArrayBuffer(0))).toEqual(new Uint8Array([1, 0]));
    expect(new Uint8Array(result?.gradientIdBuffer ?? new ArrayBuffer(0))).toEqual(new Uint8Array([2, 3]));
    expect(result?.strokeCounter).toBe(0);
    expect(documentRuntime.getLayerSnapshot).not.toHaveBeenCalled();
    expect(canReadColorCycleBrushLayerSnapshotFromRuntime({
      getColorCycleLayerDocument: documentRuntime.getColorCycleLayerDocument,
    })).toBe(true);
  });

  it('serializes animator state without duplicating index buffers when stroke snapshots own paint', () => {
    const buffers = makeBuffers(3);
    buffers.paint.set([1, 0, 3]);
    const strokeState = {
      buffers,
      hasContent: true,
      strokeCounter: 4,
    };
    const animators = new Map([
      ['layer-a', {
        serialize: () => ({
          indexBuffer: {
            data: new Uint8Array([9, 9, 9]),
            gradientId: new Uint8Array([8, 8, 8]),
          },
        }),
      }],
    ]);

    const serialized = serializeColorCycleBrushState({
      animators,
      getStrokeState: () => strokeState,
      ensureStrokeSnapshot: (state) => {
        state.snapshot = {
          paintBuffer: state.buffers.paint.slice().buffer,
          hasContent: true,
          strokeCounter: 4,
        };
      },
      hasPaintContent: (buffer) => Boolean(buffer?.byteLength),
      hasStrokeContent: () => true,
      getLayerMeta: () => ({
        activeGradientId: 'def-1',
        fgDerivedGradients: [{
          key: 'fg',
          slot: 1,
          spec: {
            mode: 'fg-derived',
            baseColor: '#ff0000',
            lightness: 0,
            bands: 12,
            algoVersion: 1,
            key: 'fg',
          },
        }],
      }),
      getFallbackStrokeCounter: () => 1,
      settings: {
        cycleSpeed: 1,
        fps: 30,
        brushSize: 5,
      },
    });

    expect(serialized.layers).toHaveLength(1);
    expect(serialized.layers[0]?.strokeData?.strokeCounter).toBe(4);
    expect(serialized.layers[0]?.activeGradientId).toBe('def-1');
    expect(serialized.layers[0]?.derivedGradients).toEqual([
      {
        key: 'fg',
        slot: 1,
        spec: {
          mode: 'fg-derived',
          baseColor: '#ff0000',
          lightness: 0,
          bands: 12,
          algoVersion: 1,
          key: 'fg',
        },
      },
    ]);
    expect(serialized.layers[0]?.data.indexBuffer?.data).toEqual(new Uint8Array(0));
    expect(serialized.layers[0]?.data.indexBuffer?.gradientId).toEqual(new Uint8Array(0));
  });

  it('serializes document snapshots ahead of stale stroke buffers', () => {
    const strokeBuffers = makeBuffers(3);
    strokeBuffers.paint.set([1, 1, 1]);
    const documentPaint = new Uint8Array([4, 0, 0]);
    const strokeState = {
      buffers: strokeBuffers,
      hasContent: true,
      strokeCounter: 8,
    };
    const animators = new Map([
      ['layer-a', {
        serialize: () => ({
          indexBuffer: {
            data: new Uint8Array([9, 9, 9]),
          },
        }),
      }],
    ]);
    const ensureStrokeSnapshot = jest.fn();

    const serialized = serializeColorCycleBrushState({
      animators,
      getStrokeState: () => strokeState,
      getDocumentRead: () => ({
        version: 2,
        pixelVersion: 2,
        snapshot: {
          layerId: 'layer-a',
          width: 3,
          height: 1,
          paintBuffer: documentPaint.buffer,
          hasContent: true,
          sources: {
            brushStateSnapshot: false,
            topLevelBuffers: false,
            legacyStateRefs: false,
          },
        },
      }),
      ensureStrokeSnapshot,
      hasPaintContent: (buffer) => Boolean(buffer?.byteLength),
      hasStrokeContent: () => true,
      getLayerMeta: () => null,
      getFallbackStrokeCounter: () => 1,
      settings: {
        cycleSpeed: 1,
        fps: 30,
        brushSize: 5,
      },
    });

    expect(ensureStrokeSnapshot).not.toHaveBeenCalled();
    expect(Array.from(new Uint8Array(serialized.layers[0]?.strokeData?.paintBuffer ?? new ArrayBuffer(0)))).toEqual([4, 0, 0]);
    expect(serialized.layers[0]?.strokeData?.strokeCounter).toBe(8);
    expect(serialized.layers[0]?.data.indexBuffer?.data).toEqual(new Uint8Array(0));
    documentPaint[0] = 0;
    expect(Array.from(new Uint8Array(serialized.layers[0]?.strokeData?.paintBuffer ?? new ArrayBuffer(0)))).toEqual([4, 0, 0]);
  });

  it('applies paint patch bytes and scalar companion buffers into document buffers', () => {
    const buffers = makeBuffers(9);
    const result = applyColorCycleBrushPaintPatchToBuffers({
      canvasWidth: 3,
      canvasHeight: 3,
      buffers,
      roi: { x: 1, y: 1, width: 2, height: 1 },
      bytes: new Uint8Array([5, 0]),
      extras: {
        gradientIdBytes: new Uint8Array([2, 3]),
        gradientDefIdBytes: new Uint8Array(new Uint16Array([11, 12]).buffer),
        speedBytes: new Uint8Array([7, 8]),
        flowBytes: new Uint8Array([1, 1]),
        phaseBytes: new Uint8Array([9, 10]),
      },
    });

    expect(result).toEqual({ x: 1, y: 1, width: 2, height: 1, hasNonZero: true });
    expect(Array.from(buffers.paint)).toEqual([0, 0, 0, 0, 5, 0, 0, 0, 0]);
    expect(Array.from(buffers.gid)).toEqual([0, 0, 0, 0, 2, 3, 0, 0, 0]);
    expect(Array.from(buffers.def)).toEqual([0, 0, 0, 0, 11, 12, 0, 0, 0]);
    expect(Array.from(buffers.spd)).toEqual([0, 0, 0, 0, 7, 8, 0, 0, 0]);
    expect(Array.from(buffers.flow)).toEqual([0, 0, 0, 0, 1, 1, 0, 0, 0]);
    expect(Array.from(buffers.phase)).toEqual([0, 0, 0, 0, 9, 10, 0, 0, 0]);

    const strokeState = { buffers, hasContent: false, strokeCounter: 12 };
    expect(commitColorCycleBrushPaintPatchResultToStrokeState(strokeState, result!)).toEqual({
      hasContent: true,
      publish: {
        hasContent: true,
        strokeCounter: 12,
        reason: 'history-restore',
      },
    });
    expect(strokeState.hasContent).toBe(true);

    const events: string[] = [];
    executeColorCycleBrushPaintPatchAnimatorSync({
      patchResult: result!,
      buffers,
      setDefIdData: (def) => events.push(`def:${def[4]}`),
      setIndexBuffers: (nextBuffers) => events.push(`index:${nextBuffers.paint[4]}`),
      bindStrokeBuffers: () => events.push('bind'),
      snapshotFromBuffers: () => events.push('snapshot'),
      markDirtyBounds: (bounds) => events.push(`dirty:${bounds.minX},${bounds.minY},${bounds.width},${bounds.height}`),
    });
    expect(events).toEqual(['def:11', 'index:5', 'bind', 'snapshot', 'dirty:1,1,2,1']);

    const resilientEvents: string[] = [];
    executeColorCycleBrushPaintPatchAnimatorSync({
      patchResult: result!,
      buffers,
      setDefIdData: () => {
        throw new Error('def upload failed');
      },
      setIndexBuffers: () => resilientEvents.push('index'),
      bindStrokeBuffers: () => resilientEvents.push('bind'),
      snapshotFromBuffers: () => resilientEvents.push('snapshot'),
      markDirtyBounds: (bounds) => resilientEvents.push(`dirty:${bounds.width}`),
    });
    expect(resilientEvents).toEqual(['dirty:2']);

    const runtimeBuffers = makeBuffers(9);
    const runtimeStrokeState = { buffers: runtimeBuffers, hasContent: false, strokeCounter: 22 };
    const runtimeEvents: string[] = [];
    const runtimeResult = executeColorCycleBrushPaintPatchRuntimeApply({
      layerId: 'layer-runtime',
      roi: { x: 1, y: 1, width: 1, height: 1 },
      bytes: new Uint8Array([4]),
      extras: {
        gradientIdBytes: new Uint8Array([5]),
        gradientDefIdBytes: new Uint8Array(new Uint16Array([13]).buffer),
      },
      canvasWidth: 3,
      canvasHeight: 3,
      ensureStrokeState: (layerId) => {
        runtimeEvents.push(`stroke:${layerId}`);
        return runtimeStrokeState;
      },
      ensureAnimator: (layerId) => {
        runtimeEvents.push(`animator:${layerId}`);
        return { id: layerId };
      },
      bindStrokeBuffersToAnimator: (_strokeState, animator) => {
        runtimeEvents.push(`bind:${animator.id}`);
      },
      publishStrokeState: (layerId, strokeState, publish) => {
        runtimeEvents.push(`publish:${layerId}:${strokeState.hasContent}:${publish.reason}`);
      },
      setDefIdData: (_animator, def) => runtimeEvents.push(`def:${def[4]}`),
      setIndexBuffers: (_animator, nextBuffers) => runtimeEvents.push(`index:${nextBuffers.paint[4]}`),
      snapshotFromBuffers: (strokeState) => runtimeEvents.push(`snapshot:${strokeState.hasContent}`),
      markDirtyBounds: (_animator, bounds) => runtimeEvents.push(`dirty:${bounds.minX},${bounds.minY}`),
      markLayerDirty: (layerId) => runtimeEvents.push(`layer-dirty:${layerId}`),
    });

    expect(runtimeResult).toBe(true);
    expect(runtimeEvents).toEqual([
      'stroke:layer-runtime',
      'animator:layer-runtime',
      'bind:layer-runtime',
      'publish:layer-runtime:true:history-restore',
      'def:13',
      'index:4',
      'bind:layer-runtime',
      'snapshot:true',
      'dirty:1,1',
      'layer-dirty:layer-runtime',
    ]);
  });

  it('keeps richer persisted metadata while accepting coherent store selections', () => {
    const cache = new ColorCycleBrushPersistenceMetaCache();
    cache.set('layer-a', {
      gradientDefs: [
        { id: 'archive-def', currentSlot: 3 },
        { id: 'store-def', currentSlot: 1 },
      ],
      slotPalettes: [
        { slot: 3, stops: [{ position: 0, color: '#000000' }] },
        { slot: 1, stops: [{ position: 0, color: '#ffffff' }] },
      ],
      gradientDefStore: [
        {
          id: 30,
          kind: 'linear',
          stops: [{ position: 0, color: '#000000' }],
          hash: 'archive',
          source: 'manual',
          createdAtMs: 1,
          slot: 3,
        },
      ],
      paintSlot: 3,
      activeGradientId: 'archive-def',
      nextGradientDefId: 31,
    });

    const merged = cache.merge('layer-a', {
      gradientDefs: [{ id: 'store-def', currentSlot: 1 }],
      slotPalettes: [{ slot: 1, stops: [{ position: 0, color: '#ffffff' }] }],
      paintSlot: 1,
      activeGradientId: 'store-def',
      nextGradientDefId: 2,
    });

    expect(merged?.gradientDefs?.map((entry) => entry.id)).toEqual(['archive-def', 'store-def']);
    expect(merged?.slotPalettes?.map((entry) => entry.slot)).toEqual([3, 1]);
    expect(merged?.paintSlot).toBe(1);
    expect(merged?.activeGradientId).toBe('store-def');
    expect(merged?.nextGradientDefId).toBe(31);
  });

  it('stores persisted metadata in document-owned owner caches', () => {
    const ownerA = {};
    const ownerB = {};
    setColorCycleBrushPersistenceLayerMeta(ownerA, 'layer-a', {
      gradientDefs: [{ id: 'archive-def', currentSlot: 3 }],
      slotPalettes: [{ slot: 3, stops: [{ position: 0, color: '#000000' }] }],
      paintSlot: 3,
      activeGradientId: 'archive-def',
    });
    setColorCycleBrushPersistenceLayerMeta(ownerB, 'layer-a', {
      gradientDefs: [{ id: 'other-def', currentSlot: 4 }],
      slotPalettes: [{ slot: 4, stops: [{ position: 0, color: '#ff00ff' }] }],
      paintSlot: 4,
      activeGradientId: 'other-def',
    });

    const ownerAMerged = mergeColorCycleBrushPersistenceLayerMetaForOwner(ownerA, 'layer-a', {
      gradientDefs: [{ id: 'store-def', currentSlot: 1 }],
      slotPalettes: [{ slot: 1, stops: [{ position: 0, color: '#ffffff' }] }],
      paintSlot: 1,
      activeGradientId: 'store-def',
    });
    const ownerBMerged = mergeColorCycleBrushPersistenceLayerMetaForOwner(ownerB, 'layer-a', null);

    expect(ownerAMerged?.gradientDefs?.map((entry) => entry.id)).toEqual(['store-def', 'archive-def']);
    expect(ownerAMerged?.paintSlot).toBe(1);
    expect(ownerBMerged?.gradientDefs?.map((entry) => entry.id)).toEqual(['other-def']);

    clearColorCycleBrushPersistenceLayerMetaForOwner(ownerA);
    expect(mergeColorCycleBrushPersistenceLayerMetaForOwner(ownerA, 'layer-a', null)).toBeNull();
    expect(mergeColorCycleBrushPersistenceLayerMetaForOwner(ownerB, 'layer-a', null)?.paintSlot).toBe(4);
    clearColorCycleBrushPersistenceLayerMetaForOwner(ownerB);
  });

  it('stores mutable stroke states in document-owned owner caches', () => {
    const ownerA = {};
    const ownerB = {};
    const strokeA = {
      buffers: makeBuffers(2),
      hasContent: true,
      strokeCounter: 1,
    };
    const strokeB = {
      buffers: makeBuffers(2),
      hasContent: false,
      strokeCounter: 2,
    };

    setColorCycleBrushStrokeStateForOwner(ownerA, 'layer-a', strokeA);
    setColorCycleBrushStrokeStateForOwner(ownerB, 'layer-a', strokeB);

    expect(hasColorCycleBrushStrokeStateForOwner(ownerA, 'layer-a')).toBe(true);
    expect(getColorCycleBrushStrokeStateForOwner(ownerA, 'layer-a')).toBe(strokeA);
    expect(getColorCycleBrushStrokeStateForOwner(ownerB, 'layer-a')).toBe(strokeB);
    expect(getColorCycleBrushStrokeStateEntriesForOwner(ownerA)).toEqual([['layer-a', strokeA]]);
    expect(getColorCycleBrushStrokeStateValuesForOwner(ownerB)).toEqual([strokeB]);

    clearColorCycleBrushStrokeStatesForOwner(ownerA);
    expect(getColorCycleBrushStrokeStateForOwner(ownerA, 'layer-a')).toBeUndefined();
    expect(getColorCycleBrushStrokeStateForOwner(ownerB, 'layer-a')).toBe(strokeB);
    clearColorCycleBrushStrokeStatesForOwner(ownerB);
  });

  it('maps layer color-cycle data into cloned persistence metadata', () => {
    const layerData = {
      gradientDefs: [{ id: 'def-a', name: 'A', currentSlot: 2 }],
      slotPalettes: [{ slot: 2, stops: [{ position: 0, color: '#ffffff' }] }],
      gradientDefStore: [{
        id: 12,
        kind: 'linear' as const,
        stops: [{ position: 0, color: '#ffffff' }],
        hash: 'hash-a',
        source: 'manual' as const,
        seamProfile: 'soft' as const,
        createdAtMs: 100,
        slot: 2,
        speedCps: 0.4,
      }],
      nextGradientDefId: 13,
      paintSlot: 2,
      legacyRemap: { from: 63, to: 2 },
      fgActiveSlot: 1,
      fgDerivedKey: 'fg-key',
      fgDerivedGradients: [{
        key: 'fg-key',
        slot: 1,
        spec: {
          mode: 'fg-derived' as const,
          baseColor: '#ff0000',
          lightness: 0,
          bands: 12,
          algoVersion: 1,
          key: 'fg-key',
        },
      }],
      activeGradientId: 'def-a',
    };

    const meta = createColorCycleBrushPersistenceLayerMetaFromLayerData(layerData);

    expect(meta).toMatchObject({
      gradientDefs: [{ id: 'def-a', name: 'A', currentSlot: 2 }],
      slotPalettes: [{ slot: 2, stops: [{ position: 0, color: '#ffffff' }], seamProfile: 'soft' }],
      gradientDefStore: [{
        id: 12,
        kind: 'linear',
        stops: [{ position: 0, color: '#ffffff' }],
        hash: 'hash-a',
        source: 'manual',
        seamProfile: 'soft',
        createdAtMs: 100,
        slot: 2,
        speedCps: 0.4,
      }],
      nextGradientDefId: 13,
      paintSlot: 2,
      legacyRemap: { from: 63, to: 2 },
      fgActiveSlot: 1,
      fgDerivedKey: 'fg-key',
      activeGradientId: 'def-a',
    });
    layerData.slotPalettes[0].stops[0].color = '#000000';
    layerData.fgDerivedGradients[0].spec.baseColor = '#00ff00';
    expect(meta?.slotPalettes?.[0]?.stops).toEqual([{ position: 0, color: '#ffffff' }]);
    expect(meta?.fgDerivedGradients?.[0]?.spec.baseColor).toBe('#ff0000');
    expect(createColorCycleBrushPersistenceLayerMetaFromLayerData(null)).toBeNull();
  });

  it('detects paint payloads from buffers, content flags, and paint bytes', () => {
    expect(colorCycleBrushSnapshotHasPaintPayload(new ArrayBuffer(2))).toBe(true);
    expect(colorCycleBrushSnapshotHasPaintPayload({ hasContent: true })).toBe(true);
    expect(colorCycleBrushSnapshotHasPaintPayload({ paintBuffer: new Uint8Array([0, 4, 0]).buffer })).toBe(true);
    expect(colorCycleBrushSnapshotHasPaintPayload({ paintBuffer: new Uint8Array([0, 0, 0]).buffer })).toBe(false);
    expect(colorCycleBrushSnapshotHasPaintPayload(null)).toBe(false);
  });

  it('plans deserialized settings as one brush settings patch', () => {
    expect(createColorCycleBrushDeserializeSettingsPatch({
      cycleSpeed: 0.2,
      layerBaseSpeed: 0.3,
      playbackSpeedScale: 1.5,
      fps: 24,
      brushSize: 9,
      ditherEnabled: true,
      ditherStrength: 0.6,
      ditherPixelSize: 3,
      perceptualDither: true,
      stampShape: 'diamond7',
      stampDitherEnabled: true,
      stampDitherPixelSize: 2,
      stampDitherAlgorithm: 'sierra-lite',
      stampDitherPatternStyle: 'dots',
      stampDitherPatternTileId: 'tile-a',
      stampDitherPatternTileScale: 2,
      stampDitherPatternTileInvert: true,
      stampDitherPatternTileThreshold: 0.5,
      stampDitherPatternTileOffsetX: 4,
      stampDitherPatternTileOffsetY: 5,
      stampDitherBgFill: false,
      stampDitherClears: false,
      stampDitherPressureLinked: true,
      pxlEdgeEnabled: true,
    })).toMatchObject({
      cycleSpeed: 0.2,
      layerBaseSpeed: 0.3,
      playbackSpeedScale: 1.5,
      fps: 24,
      brushSize: 9,
      ditherEnabled: true,
      ditherStrength: 0.6,
      ditherPixelSize: 3,
      perceptualDither: true,
      stampShape: 'diamond7',
      stampDitherEnabled: true,
      stampDitherPixelSize: 2,
      stampDitherAlgorithm: 'sierra-lite',
      stampDitherPatternStyle: 'dots',
      stampDitherPatternTileId: 'tile-a',
      stampDitherPatternTileScale: 2,
      stampDitherPatternTileInvert: true,
      stampDitherPatternTileThreshold: 0.5,
      stampDitherPatternTileOffsetX: 4,
      stampDitherPatternTileOffsetY: 5,
      stampDitherBgFill: false,
      stampDitherPressureLinked: true,
      pxlEdgeEnabled: true,
    });

    expect(createColorCycleBrushDeserializeSettingsPatch({
      stampShape: 'legacy-shape',
      stampDitherClears: true,
    }).stampShape).toBeUndefined();
    expect(createColorCycleBrushDeserializeSettingsPatch({
      stampDitherClears: true,
    }).stampDitherBgFill).toBe(false);
  });

  it('plans serialized settings and derives the legacy clears flag', () => {
    expect(createColorCycleBrushSerializeSettings({
      cycleSpeed: 0.2,
      layerBaseSpeed: 0.3,
      playbackSpeedScale: 1.5,
      fps: 24,
      brushSize: 9,
      ditherEnabled: true,
      ditherStrength: 0.6,
      ditherPixelSize: 3,
      perceptualDither: true,
      stampShape: 'diamond7',
      stampDitherEnabled: true,
      stampDitherPixelSize: 2,
      stampDitherAlgorithm: 'sierra-lite',
      stampDitherPatternStyle: 'dots',
      stampDitherPatternTileId: 'tile-a',
      stampDitherPatternTileScale: 2,
      stampDitherPatternTileInvert: true,
      stampDitherPatternTileThreshold: 0.5,
      stampDitherPatternTileOffsetX: 4,
      stampDitherPatternTileOffsetY: 5,
      stampDitherBgFill: false,
      stampDitherPressureLinked: true,
      pxlEdgeEnabled: true,
    })).toMatchObject({
      cycleSpeed: 0.2,
      layerBaseSpeed: 0.3,
      playbackSpeedScale: 1.5,
      fps: 24,
      brushSize: 9,
      ditherEnabled: true,
      ditherStrength: 0.6,
      ditherPixelSize: 3,
      perceptualDither: true,
      stampShape: 'diamond7',
      stampDitherEnabled: true,
      stampDitherPixelSize: 2,
      stampDitherAlgorithm: 'sierra-lite',
      stampDitherPatternStyle: 'dots',
      stampDitherPatternTileId: 'tile-a',
      stampDitherPatternTileScale: 2,
      stampDitherPatternTileInvert: true,
      stampDitherPatternTileThreshold: 0.5,
      stampDitherPatternTileOffsetX: 4,
      stampDitherPatternTileOffsetY: 5,
      stampDitherBgFill: false,
      stampDitherClears: true,
      stampDitherPressureLinked: true,
      pxlEdgeEnabled: true,
    });
    expect(createColorCycleBrushSerializeSettings({
      cycleSpeed: 0.2,
      fps: 24,
      brushSize: 9,
      stampDitherBgFill: true,
    }).stampDitherClears).toBe(false);
  });

  it('plans deserialized layer snapshot applies with cloned payloads and metadata', () => {
    const paintBytes = new Uint8Array([0, 0]);
    const gradientBytes = new Uint8Array([2, 3]);
    const gradientDefValues = new Uint16Array([7, 8]);
    const speedBytes = new Uint8Array([4, 5]);
    const flowBytes = new Uint8Array([6, 7]);
    const phaseBytes = new Uint8Array([8, 9]);
    const indexBytes = new Uint8Array([9, 1]);

    const [plan] = createColorCycleBrushDeserializeLayerApplyPlans([{
      layerId: 'layer-a',
      data: {
        gradient: {
          gradientStops: [{ position: 0, color: '#000000' }],
        },
        indexBuffer: {
          width: 2,
          height: 1,
          data: indexBytes,
          gradientId: gradientBytes,
          speedData: speedBytes,
          flowData: flowBytes,
          phaseData: phaseBytes,
        },
      },
      strokeData: {
        paintBuffer: paintBytes.buffer,
        gradientIdBuffer: gradientBytes.buffer,
        gradientDefIdBuffer: gradientDefValues.buffer,
        speedBuffer: speedBytes.buffer,
        flowBuffer: flowBytes.buffer,
        phaseBuffer: phaseBytes.buffer,
        hasContent: false,
        strokeCounter: 12,
      },
      gradientDefs: [{ id: 'def-a', currentSlot: 3 }],
      slotPalettes: [{ slot: 3, stops: [{ position: 1, color: '#ffffff' }] }],
      paintSlot: 3,
      activeGradientId: 'def-a',
      legacyRemap: { from: 63, to: 3 },
    } as NonNullable<Parameters<typeof createColorCycleBrushDeserializeLayerApplyPlans>[0]>[number]]);

    expect(plan).toBeDefined();
    if (!plan) {
      throw new Error('expected a deserialize apply plan');
    }
    expect(plan.layerId).toBe('layer-a');
    expect(plan.meta?.paintSlot).toBe(3);
    expect(plan.meta?.gradientDefs?.[0]).toEqual({ id: 'def-a', name: undefined, currentSlot: 3 });
    expect(plan.snapshot.hasContent).toBe(true);
    expect(plan.snapshot.strokeCounter).toBe(12);
    expect(Array.from(new Uint8Array(plan.snapshot.paintBuffer))).toEqual([0, 0]);
    expect(Array.from(new Uint16Array(plan.snapshot.gradientDefIdBuffer ?? new ArrayBuffer(0)))).toEqual([7, 8]);
    expect(plan.animatorIndex).toMatchObject({
      width: 2,
      height: 1,
      paintSlot: 3,
      activeGradientId: 'def-a',
      legacyRemap: { from: 63, to: 3 },
    });
    expect(Array.from(new Uint8Array(plan.animatorIndex?.data ?? new ArrayBuffer(0)))).toEqual([9, 1]);

    paintBytes[0] = 99;
    indexBytes[0] = 88;
    gradientDefValues[0] = 77;
    expect(Array.from(new Uint8Array(plan.snapshot.paintBuffer))).toEqual([0, 0]);
    expect(Array.from(new Uint8Array(plan.animatorIndex?.data ?? new ArrayBuffer(0)))).toEqual([9, 1]);
    expect(Array.from(new Uint16Array(plan.snapshot.gradientDefIdBuffer ?? new ArrayBuffer(0)))).toEqual([7, 8]);
  });

  it('plans project-load clears and blocks empty snapshots over canonical payloads', () => {
    const plan = createColorCycleBrushFullStateRestorePlan({
      state: {
        cycleSpeed: 0.7,
        layerSnapshots: [
          {
            layerId: 'layer-a',
            paintBuffer: new Uint8Array([0, 0]).buffer,
            strokeCounter: 3,
          },
          {
            layerId: 'layer-b',
            paintBuffer: new Uint8Array([0, 9]).buffer,
            strokeCounter: 6,
          },
        ],
      },
      asHistory: false,
      currentStrokeCounter: 11,
      isProduction: false,
      hasCanonicalPaintPayload: (layerId) => layerId === 'layer-a',
    });

    expect(plan.asHistory).toBe(false);
    expect(plan.shouldAssertNoClear).toBe(false);
    expect(plan.highestStrokeCounter).toBeNull();
    expect(plan.shouldClearComposite).toBe(true);
    expect(plan.clearOperations.map((op) => ({
      layerId: op.layerId,
      blockedByCanonicalPayload: op.blockedByCanonicalPayload,
    }))).toEqual([
      { layerId: 'layer-a', blockedByCanonicalPayload: true },
      { layerId: 'layer-b', blockedByCanonicalPayload: false },
    ]);
    expect(plan.applyOperations.map((op) => ({
      layerId: op.layerId,
      hasContent: op.snapshot.hasContent,
      strokeCounter: op.snapshot.strokeCounter,
      reason: op.reason,
    }))).toEqual([
      { layerId: 'layer-a', hasContent: false, strokeCounter: 3, reason: 'project-load-restore' },
      { layerId: 'layer-b', hasContent: true, strokeCounter: 6, reason: 'project-load-restore' },
    ]);
  });

  it('plans restore blocked-clear audit payloads', () => {
    expect(createColorCycleBrushRestoreBlockedClearAuditPlan({
      existingHasContent: true,
      brushStateHasPayload: true,
    })).toEqual({
      severity: 'warn',
      details: {
        source: 'project-load',
        snapshotReason: 'project-load-restore',
        existingHasContent: true,
        brushStateHasPayload: true,
      },
    });
    expect(createColorCycleBrushRestoreBlockedClearAuditPlan({
      existingHasContent: null,
      brushStateHasPayload: false,
    }).details).toEqual({
      source: 'project-load',
      snapshotReason: 'project-load-restore',
      existingHasContent: null,
      brushStateHasPayload: false,
    });
  });

  it('clears restore stroke state through the document adapter contract', () => {
    const buffers = makeBuffers(3);
    buffers.paint.set([1, 2, 3]);
    buffers.gid.set([4, 5, 6]);
    buffers.spd.set([7, 8, 9]);
    buffers.flow.set([1, 1, 1]);
    buffers.phase.set([2, 2, 2]);
    buffers.def.set([10, 11, 12]);
    const strokeState: ColorCycleBrushLayerSnapshotMutableStrokeState = {
      buffers,
      hasContent: true,
      contentIsOptimistic: true,
      externalBase: { hasExternalBase: true },
      strokeCounter: 9,
      lastPoint: { x: 1, y: 2 },
      stampCounter: 3,
      strokePhaseUnits: 4,
      snapshot: {
        paintBuffer: new Uint8Array([1]).buffer,
        hasContent: true,
        strokeCounter: 9,
      },
      stampDither: { enabled: true },
    };

    expect(clearColorCycleBrushStrokeStateForRestore(strokeState)).toEqual({
      hasContent: false,
      strokeCounter: 0,
    });
    expect(Array.from(strokeState.buffers.paint)).toEqual([0, 0, 0]);
    expect(Array.from(strokeState.buffers.gid)).toEqual([0, 0, 0]);
    expect(Array.from(strokeState.buffers.spd)).toEqual([0, 0, 0]);
    expect(Array.from(strokeState.buffers.flow)).toEqual([0, 0, 0]);
    expect(Array.from(strokeState.buffers.phase)).toEqual([0, 0, 0]);
    expect(Array.from(strokeState.buffers.def)).toEqual([0, 0, 0]);
    expect(strokeState.hasContent).toBe(false);
    expect(strokeState.contentIsOptimistic).toBe(false);
    expect(strokeState.externalBase?.hasExternalBase).toBe(false);
    expect(strokeState.strokeCounter).toBe(0);
    expect(strokeState.lastPoint).toBeNull();
    expect(strokeState.stampCounter).toBe(0);
    expect(strokeState.strokePhaseUnits).toBe(0);
    expect(strokeState.snapshot).toBeUndefined();
    expect(strokeState.stampDither).toBeUndefined();
  });

  it('plans history restores without clears and preserves the highest stroke counter', () => {
    const plan = createColorCycleBrushFullStateRestorePlan({
      state: {
        layerSnapshots: new Map([
          ['layer-a', new Uint8Array([0, 1]).buffer],
          ['layer-b', new Uint8Array([0, 0]).buffer],
        ]),
      },
      asHistory: true,
      currentStrokeCounter: 14,
      isProduction: false,
      hasCanonicalPaintPayload: () => true,
    });

    expect(plan.clearOperations).toHaveLength(0);
    expect(plan.shouldClearComposite).toBe(false);
    expect(plan.shouldAssertNoClear).toBe(true);
    expect(plan.highestStrokeCounter).toBe(0);
    expect(plan.applyOperations.map((op) => ({
      layerId: op.layerId,
      hasContent: op.snapshot.hasContent,
      strokeCounter: op.snapshot.strokeCounter,
      reason: op.reason,
    }))).toEqual([
      { layerId: 'layer-a', hasContent: true, strokeCounter: 0, reason: 'history-restore' },
      { layerId: 'layer-b', hasContent: true, strokeCounter: 0, reason: 'history-restore' },
    ]);
  });

  it('executes restore plans in settings-clear-apply-counter order', () => {
    const plan = createColorCycleBrushFullStateRestorePlan({
      state: {
        stampDitherClears: true,
        layerSnapshots: [
          {
            layerId: 'blocked-layer',
            paintBuffer: new Uint8Array([0, 0]).buffer,
          },
          {
            layerId: 'clear-layer',
            paintBuffer: new Uint8Array([2, 0]).buffer,
            strokeCounter: 9,
          },
        ],
      },
      asHistory: false,
      currentStrokeCounter: 3,
      isProduction: true,
      hasCanonicalPaintPayload: (layerId) => layerId === 'blocked-layer',
    });
    const events: string[] = [];

    executeColorCycleBrushFullStateRestorePlan({
      plan,
      applySettings: () => events.push('settings'),
      applyLegacyStampDitherClears: () => events.push('legacy-clears'),
      logBlockedClear: (operation) => events.push(`blocked:${operation.layerId}`),
      clearLayer: (operation) => events.push(`clear:${operation.layerId}`),
      clearComposite: () => events.push('composite'),
      applyLayerSnapshot: (operation) => events.push(`apply:${operation.layerId}`),
      setHighestStrokeCounter: (strokeCounter) => events.push(`counter:${strokeCounter}`),
    });

    expect(events).toEqual([
      'settings',
      'legacy-clears',
      'blocked:blocked-layer',
      'clear:clear-layer',
      'composite',
      'apply:blocked-layer',
      'apply:clear-layer',
    ]);
  });

  it('asserts when a history restore plan unexpectedly clears', () => {
    const plan = {
      asHistory: true,
      shouldAssertNoClear: true,
      settings: {},
      clearOperations: [{
        layerId: 'layer-a',
        incomingSnapshot: undefined,
        blockedByCanonicalPayload: false,
      }],
      shouldClearComposite: false,
      applyOperations: [],
      highestStrokeCounter: 5,
    };
    const assertions: boolean[] = [];

    executeColorCycleBrushFullStateRestorePlan({
      plan,
      applySettings: () => undefined,
      logBlockedClear: () => undefined,
      clearLayer: () => undefined,
      clearComposite: () => undefined,
      applyLayerSnapshot: () => undefined,
      setHighestStrokeCounter: () => undefined,
      assertNoClear: (clearedDuringRestore) => assertions.push(clearedDuringRestore),
    });

    expect(assertions).toEqual([true]);
  });

  it('plans committed layer store sync only for buffers that differ from the document', () => {
    const unchangedGradient = new Uint8Array([1, 2, 3]).buffer;
    const changedDef = new Uint16Array([10, 12]).buffer;
    const patch = createColorCycleCommittedLayerStoreSyncPatch({
      snapshot: {
        gradientIdBuffer: unchangedGradient,
        gradientDefIdBuffer: changedDef,
      },
      documentSnapshot: {
        gradientIdBuffer: new Uint8Array([1, 2, 3]).buffer,
        gradientDefIdBuffer: new Uint16Array([10, 11]).buffer,
      },
    });

    expect(patch).toEqual({ gradientDefIdBuffer: changedDef });
    expect(createColorCycleCommittedLayerStoreSyncPatch({
      snapshot: {
        gradientIdBuffer: unchangedGradient,
      },
      documentSnapshot: {
        gradientIdBuffer: new Uint8Array([1, 2, 3]).buffer,
      },
    })).toBeNull();
  });

  it('remaps committed gradient slots in a bounded painted region', () => {
    const indexData = new Uint8Array([
      1, 1, 0,
      1, 1, 1,
      1, 1, 1,
    ]);
    const gidData = new Uint8Array([
      5, 5, 5,
      5, 7, 5,
      5, 5, 5,
    ]);

    const dirtyBounds = remapColorCycleCommittedGradientSlot({
      indexData,
      gidData,
      width: 3,
      height: 3,
      fromSlot: 5,
      toSlot: 2,
      flowSlotMask: 63,
      bbox: { minX: 0, minY: 0, width: 2, height: 2 },
    });

    expect(dirtyBounds).toEqual({ x: 0, y: 0, width: 2, height: 2 });
    expect(Array.from(gidData)).toEqual([
      2, 2, 5,
      2, 7, 5,
      5, 5, 5,
    ]);
  });

  it('binds committed gradient def ids to preview-slot pixels and clears empty pixels', () => {
    const buffers = makeBuffers(4);
    buffers.paint.set([1, 1, 0, 1]);
    buffers.gid.set([9, 3, 9, 3]);
    buffers.def.set([0, 0, 12, 0]);

    const result = bindColorCycleCommittedGradientDefToSlot({
      buffers,
      canvasWidth: 2,
      canvasHeight: 2,
      defId: 44,
      slot: 3,
      flowSlotMask: 63,
      previewSlot: 9,
      trackPreviewLeak: true,
    });

    expect(result).toEqual({
      leftoverPreview: 0,
      effectivePreviewSlot: 9,
      committedSlot: 3,
    });
    expect(Array.from(buffers.gid)).toEqual([3, 3, 9, 3]);
    expect(Array.from(buffers.def)).toEqual([44, 44, 0, 44]);
  });

  it('binds committed gradient def ids only within the supplied region', () => {
    const buffers = makeBuffers(6);
    buffers.paint.fill(1);
    buffers.gid.fill(5);
    buffers.def.fill(0);

    bindColorCycleCommittedGradientDefToSlot({
      buffers,
      canvasWidth: 3,
      canvasHeight: 2,
      defId: 30,
      slot: 5,
      flowSlotMask: 63,
      bbox: { minX: 1, minY: 0, width: 2, height: 1 },
    });

    expect(Array.from(buffers.def)).toEqual([0, 30, 30, 0, 0, 0]);
  });

  it('executes committed layer binding before canvas presentation', () => {
    const events: string[] = [];
    const targetCanvas = {} as HTMLCanvasElement;

    executeColorCycleCommittedLayerState({
      options: {
        layerId: 'layer-a',
        targetCanvas,
        opacity: 0.5,
        binding: {
          defId: 12,
          slot: 3,
          bbox: { minX: 1, minY: 2, width: 3, height: 4 },
          previewSlot: 9,
        },
      },
      bindGradientDefIdToSlot: (layerId, defId, slot, bbox, previewSlot) => {
        events.push(`bind:${layerId}:${defId}:${slot}:${bbox?.width}:${previewSlot}`);
      },
      syncCommittedBuffersToLayerStore: (layerId) => events.push(`sync:${layerId}`),
      commitToLayer: (_canvas, layerId, opacity) => events.push(`commit:${layerId}:${opacity}`),
      renderDirectToCanvas: (_canvas, layerId) => events.push(`render:${layerId}`),
    });

    expect(events).toEqual([
      'bind:layer-a:12:3:3:9',
      'sync:layer-a',
      'commit:layer-a:0.5',
    ]);
  });

  it('renders committed layer directly when opacity is one', () => {
    const events: string[] = [];

    executeColorCycleCommittedLayerState({
      options: {
        layerId: 'layer-a',
        targetCanvas: {} as HTMLCanvasElement,
      },
      bindGradientDefIdToSlot: () => events.push('bind'),
      syncCommittedBuffersToLayerStore: () => events.push('sync'),
      commitToLayer: () => events.push('commit'),
      renderDirectToCanvas: (_canvas, layerId) => events.push(`render:${layerId}`),
    });

    expect(events).toEqual(['render:layer-a']);
  });

  it('plans layer snapshot apply clear auditing from selected paint payload', () => {
    expect(createColorCycleBrushLayerSnapshotRestoreGuard({
      reason: 'project-load-restore',
      restoreActionKind: 'recover-from-canonical',
    })).toEqual({
      blocksEmptySnapshot: true,
      shouldLogBlockedWrite: true,
      shouldRecoverFromCanonical: true,
      blockedSeverity: 'warn',
    });
    expect(createColorCycleBrushLayerSnapshotRestoreGuard({
      reason: 'snapshot-apply',
      restoreActionKind: 'block',
    })).toEqual({
      blocksEmptySnapshot: false,
      shouldLogBlockedWrite: false,
      shouldRecoverFromCanonical: false,
      blockedSeverity: 'error',
    });

    const plan = createColorCycleBrushLayerSnapshotApplyPlan({
      snapshot: {
        paintBuffer: new Uint8Array([0, 0, 0]).buffer,
        hasContent: false,
      },
      reason: 'project-load-restore',
      existingHasContent: true,
      hasCanonicalPaintPayload: true,
      blocksEmptySnapshot: true,
    });

    expect(plan.paintByteLength).toBe(3);
    expect(plan.selectedPaintHasContent).toBe(false);
    expect(plan.expectsContent).toBe(false);
    expect(plan.shouldAuditPotentialClear).toBe(true);
    expect(plan.shouldBlockPotentialClear).toBe(true);
    expect(plan.mutationSource).toBe('project-load');
    expect(createColorCycleBrushLayerSnapshotFallbackAnimationPlan({
      layerBaseSpeed: 0.35,
      toolSpeed: 0.2,
      layerFlowMode: 'reverse',
      brushFlowMode: 'pingpong',
    })).toEqual({
      speed: 0.35,
      flowMode: 'reverse',
    });
    expect(createColorCycleBrushLayerSnapshotFallbackAnimationPlan({
      layerBaseSpeed: undefined,
      toolSpeed: 0.2,
      layerFlowMode: null,
      brushFlowMode: 'pingpong',
    })).toEqual({
      speed: 0.2,
      flowMode: 'pingpong',
    });
    expect(createColorCycleBrushLayerSnapshotFallbackAnimationPlan({})).toEqual({
      speed: 0.1,
      flowMode: 'forward',
    });
    expect(createColorCycleBrushLayerSnapshotAnimatorSizingPlan({
      applyPlan: plan,
      width: 2,
      height: 2,
    })).toEqual({
      expectedSize: 4,
      shouldResizeAnimator: true,
      width: 2,
      height: 2,
    });
    expect(createColorCycleBrushLayerSnapshotAnimatorSizingPlan({
      applyPlan: plan,
      width: 3,
      height: 1,
    })).toEqual({
      expectedSize: 3,
      shouldResizeAnimator: false,
      width: 3,
      height: 1,
    });
    expect(createColorCycleBrushLayerSnapshotClearAuditPlan({
      applyPlan: plan,
      hasLayerContent: false,
    })).toEqual({
      source: 'project-load',
      expectedDestructive: true,
    });
    expect(createColorCycleBrushLayerSnapshotClearAuditPlan({
      applyPlan: plan,
      hasLayerContent: true,
    })).toBeNull();
    expect(createColorCycleBrushLayerSnapshotBlockedAuditDetails({
      applyPlan: plan,
      snapshot: {
        paintBuffer: new Uint8Array([0, 0, 0]).buffer,
        hasContent: false,
      },
      reason: 'project-load-restore',
      existingHasContent: true,
      brushStateHasPayload: true,
      restoredFromCanonicalBrushState: false,
    })).toEqual({
      source: 'snapshot',
      snapshotReason: 'project-load-restore',
      paintBufferBytes: 3,
      paintBufferNonZero: false,
      snapshotHasContent: false,
      existingHasContent: true,
      brushStateHasPayload: true,
      restoredFromCanonicalBrushState: false,
    });
  });

  it('plans layer snapshot apply from animator fallback payloads', () => {
    const animatorData = new Uint8Array([0, 6]).buffer;
    const plan = createColorCycleBrushLayerSnapshotApplyPlan({
      snapshot: {
        hasContent: false,
      },
      animatorIndex: {
        data: animatorData,
      },
      reason: 'history-restore',
      existingHasContent: false,
      hasCanonicalPaintPayload: false,
      blocksEmptySnapshot: false,
    });

    expect(plan.paintBuffer).toBe(animatorData);
    expect(plan.selectedPaintHasContent).toBe(true);
    expect(plan.shouldAuditPotentialClear).toBe(false);
    expect(plan.shouldBlockPotentialClear).toBe(false);
    expect(plan.mutationSource).toBe('history');
  });

  it('commits layer snapshot apply results into mutable stroke state', () => {
    const buffers = makeBuffers(2);
    const strokeState: ColorCycleBrushLayerSnapshotMutableStrokeState = {
      buffers,
      hasContent: false,
      contentIsOptimistic: true,
      externalBase: { hasExternalBase: true },
      strokeCounter: 99,
      lastPoint: { x: 1, y: 2 },
      stampCounter: 4,
      strokePhaseUnits: 7,
      stampDither: { active: true },
    };
    const nextSnapshot = {
      paintBuffer: new Uint8Array([1, 0]).buffer,
      hasContent: true,
      strokeCounter: 12,
    };

    const commit = commitColorCycleBrushLayerSnapshotApplyResultToStrokeState({
      strokeState,
      snapshot: {
        paintBuffer: nextSnapshot.paintBuffer,
        hasContent: true,
        strokeCounter: 12,
      },
      applyResult: {
        hasLayerContent: true,
        selectedPaintHasContent: true,
        isExplicitEmptySnapshot: false,
        uploadPaint: buffers.paint,
        uploadGradientId: buffers.gid,
        uploadSpeed: buffers.spd,
        uploadFlow: buffers.flow,
        uploadPhase: buffers.phase,
        nextSnapshot,
      },
      reason: 'snapshot-apply',
    });

    expect(strokeState.hasContent).toBe(true);
    expect(strokeState.contentIsOptimistic).toBe(false);
    expect(strokeState.externalBase?.hasExternalBase).toBe(false);
    expect(strokeState.strokeCounter).toBe(12);
    expect(strokeState.lastPoint).toBeNull();
    expect(strokeState.stampCounter).toBe(0);
    expect(strokeState.strokePhaseUnits).toBe(0);
    expect(strokeState.stampDither).toBeUndefined();
    expect(strokeState.snapshot).toBe(nextSnapshot);
    expect(commit).toEqual({
      publish: {
        reason: 'snapshot-apply',
        hasContent: true,
        strokeCounter: 12,
      },
    });
  });

  it('plans layer snapshot metadata updates from animator index paint slot first', () => {
    const plan = createColorCycleBrushLayerSnapshotMetadataPlan({
      paintSlot: 6,
      activeGradientId: 'active-def',
      gradientDefs: [{ id: 'active-def', currentSlot: 2 }],
      slotPalettes: [{ slot: 6, stops: [{ position: 0, color: '#000000' }], seamProfile: 'hard' }],
    });

    expect(plan.activeGradientSlot).toBe(6);
    expect(plan.slotPalettes).toEqual([
      { slot: 6, stops: [{ position: 0, color: '#000000' }], seamProfile: 'hard' },
    ]);

    const events: string[] = [];
    executeColorCycleBrushLayerSnapshotMetadataPlan({
      plan,
      applySlotPalette: (slot, stops, seamProfile) => events.push(
        `palette:${slot}:${stops[0]?.color}:${String(seamProfile)}`,
      ),
      applyActiveGradientSlot: (slot) => events.push(`active:${slot}`),
    });

    expect(events).toEqual(['palette:6:#000000:hard', 'active:6']);
  });

  it('plans layer snapshot metadata updates from active gradient definition fallback', () => {
    const plan = createColorCycleBrushLayerSnapshotMetadataPlan({
      activeGradientId: 'active-def',
      gradientDefs: [
        { id: 'other-def', currentSlot: 1 },
        { id: 'active-def', currentSlot: 4 },
      ],
    });

    expect(plan.activeGradientSlot).toBe(4);
    expect(plan.slotPalettes).toEqual([]);
  });

  it('executes layer snapshot runtime apply through adapter-owned ordering', () => {
    const events: string[] = [];
    const strokeState: ColorCycleBrushLayerSnapshotMutableStrokeState = {
      buffers: makeBuffers(4),
      hasContent: false,
      strokeCounter: 0,
    };
    const animator = {};

    executeColorCycleBrushLayerSnapshotRuntimeApply({
      layerId: 'layer-a',
      snapshot: {
        paintBuffer: new Uint8Array([1, 0, 0, 0]).buffer,
        hasContent: true,
        strokeCounter: 6,
      },
      animatorIndex: {
        gradientIdData: new Uint8Array([2, 0, 0, 0]).buffer,
        slotPalettes: [{ slot: 3, stops: [{ position: 0, color: '#ffffff' }] }],
        paintSlot: 3,
      },
      reason: 'history-restore',
      canvasWidth: 2,
      canvasHeight: 2,
      flowSlotMask: 0xff,
      getExistingStrokeState: () => undefined,
      hasCanonicalPaintPayload: () => false,
      resolveRestoreAction: () => null,
      brushStateHasPaintPayload: () => false,
      logBlockedWrite: () => events.push('blocked'),
      applyRecoveredSnapshot: () => events.push('recover'),
      ensureAnimator: () => animator,
      resizeAnimator: () => events.push('resize'),
      createStrokeState: ({ bufferSize }) => {
        events.push(`create:${bufferSize}`);
        return strokeState;
      },
      captureAuditSnapshot: () => null,
      getFallbackAnimationPlanOptions: () => ({
        layerBaseSpeed: 0.2,
        layerFlowMode: 'forward',
      }),
      encodeFallbackSpeedByte: () => 7,
      encodeFallbackFlowByte: () => 8,
      applySlotPalette: (slot) => events.push(`palette:${slot}`),
      applyActiveGradientSlot: (slot) => events.push(`active:${slot}`),
      publishStrokeState: (_layerId, state, publish) => {
        events.push(`publish:${publish.reason}:${publish.hasContent}:${publish.strokeCounter}`);
        expect(state).toBe(strokeState);
      },
      recordClearAudit: () => events.push('clear-audit'),
      setIndexBuffers: (_animator, result) => {
        events.push(`upload:${result.uploadPaint[0]}:${result.uploadGradientId[0]}`);
      },
      bindStrokeBuffersToAnimator: () => events.push('bind'),
      applyDefBindings: () => events.push('defs'),
      snapshotFromBuffers: () => events.push('snapshot'),
      getAnimatorDimensions: () => ({ width: 2, height: 2 }),
      markDirtyBounds: (_animator, bounds) => events.push(`dirty:${bounds.width}x${bounds.height}`),
      markLayerDirty: (layerId) => events.push(`layer-dirty:${layerId}`),
    });

    expect(Array.from(strokeState.buffers.paint)).toEqual([1, 0, 0, 0]);
    expect(Array.from(strokeState.buffers.gid)).toEqual([2, 0, 0, 0]);
    expect(strokeState.hasContent).toBe(true);
    expect(strokeState.strokeCounter).toBe(6);
    expect(events).toEqual([
      'create:4',
      'palette:3',
      'active:3',
      'publish:history-restore:true:6',
      'upload:1:2',
      'bind',
      'defs',
      'snapshot',
      'dirty:2x2',
      'layer-dirty:layer-a',
    ]);
  });

  it('executes layer snapshot animator sync in upload-bind-def-snapshot-dirty order', () => {
    const events: string[] = [];
    executeColorCycleBrushLayerSnapshotAnimatorSync({
      applyResult: {
        hasLayerContent: true,
        selectedPaintHasContent: true,
        isExplicitEmptySnapshot: false,
        uploadPaint: new Uint8Array([1]),
        uploadGradientId: new Uint8Array([2]),
        uploadSpeed: new Uint8Array([3]),
        uploadFlow: new Uint8Array([4]),
        uploadPhase: new Uint8Array([5]),
        nextSnapshot: {
          paintBuffer: new Uint8Array([1]).buffer,
          hasContent: true,
          strokeCounter: 1,
        },
      },
      setIndexBuffers: (result) => events.push(`upload:${result.uploadPaint[0]}`),
      bindStrokeBuffers: () => events.push('bind'),
      applyDefBindings: () => events.push('defs'),
      snapshotFromBuffers: () => events.push('snapshot'),
      getAnimatorDimensions: () => ({ width: 4, height: 3 }),
      markDirtyBounds: (bounds) => events.push(`dirty:${bounds.width}x${bounds.height}`),
    });

    expect(events).toEqual(['upload:1', 'bind', 'defs', 'snapshot', 'dirty:4x3']);
    expect(createColorCycleBrushLayerSnapshotDirtyBounds({ width: 2.8, height: 3.2 })).toEqual({
      minX: 0,
      minY: 0,
      width: 2,
      height: 3,
    });
    expect(createColorCycleBrushLayerSnapshotDirtyBounds(null)).toBeNull();
  });

  it('skips animator snapshot refresh for empty layer snapshot apply results', () => {
    const events: string[] = [];
    executeColorCycleBrushLayerSnapshotAnimatorSync({
      applyResult: {
        hasLayerContent: false,
        selectedPaintHasContent: false,
        isExplicitEmptySnapshot: true,
        uploadPaint: new Uint8Array([0]),
        uploadGradientId: new Uint8Array([0]),
        uploadSpeed: new Uint8Array([0]),
        uploadFlow: new Uint8Array([0]),
        uploadPhase: new Uint8Array([0]),
        nextSnapshot: {
          paintBuffer: new ArrayBuffer(0),
          hasContent: false,
          strokeCounter: 0,
        },
      },
      setIndexBuffers: () => events.push('upload'),
      bindStrokeBuffers: () => events.push('bind'),
      applyDefBindings: () => events.push('defs'),
      snapshotFromBuffers: () => events.push('snapshot'),
      getAnimatorDimensions: () => ({ width: 1, height: 1 }),
      markDirtyBounds: () => events.push('dirty'),
    });

    expect(events).toEqual(['upload', 'bind', 'defs', 'dirty']);
  });
});
