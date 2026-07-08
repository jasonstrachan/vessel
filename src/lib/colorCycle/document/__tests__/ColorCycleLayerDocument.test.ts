import type { ColorCycleLayerDocumentState } from '@/lib/colorCycle/documentState';

jest.mock('@/utils/debug', () => ({
  debugWarn: jest.fn(),
}));

import { debugWarn } from '@/utils/debug';

import {
  assertDerivedSurfaceFreshForRender,
  clearColorCycleLayerDocumentsForOwner,
  ColorCycleLayerDocument,
  deleteColorCycleLayerDocumentForOwner,
  getColorCycleLayerDocumentForOwner,
  hasColorCycleLayerDocumentForOwner,
  isDerivedSurfaceStale,
  registerColorCycleLayerDocumentOwnerAlias,
  setColorCycleLayerDocumentForOwner,
  type DerivedSurface,
} from '../ColorCycleLayerDocument';

const makeBuffer = (values: number[]): ArrayBuffer => new Uint8Array(values).buffer;

const readBytes = (buffer: ArrayBuffer | undefined): number[] => (
  Array.from(new Uint8Array(buffer ?? new ArrayBuffer(0)))
);

const makeState = (
  overrides: Partial<ColorCycleLayerDocumentState> = {},
): ColorCycleLayerDocumentState => ({
  layerId: 'cc-layer',
  width: 2,
  height: 2,
  paintBuffer: makeBuffer([1, 0, 0, 0]),
  gradientIdBuffer: makeBuffer([2, 0, 0, 0]),
  gradientDefIdBuffer: makeBuffer([3, 0, 0, 0, 0, 0, 0, 0]),
  speedBuffer: makeBuffer([4, 0, 0, 0]),
  flowBuffer: makeBuffer([5, 0, 0, 0]),
  phaseBuffer: makeBuffer([6, 0, 0, 0]),
  slotPalettes: [{
    slot: 1,
    stops: [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ],
  }],
  gradientDefs: [{ id: 'def-a', currentSlot: 1 }],
  gradientDefStore: [{
    id: 1,
    kind: 'linear',
    stops: [{ position: 0, color: '#000000' }],
    hash: 'hash-a',
    source: 'manual',
    createdAtMs: 1,
    slot: 1,
  }],
  activeGradientId: 'gradient-a',
  paintSlot: 1,
  fgActiveSlot: 1,
  layerBaseSpeedCps: 1,
  flowMode: 'forward',
  hasContent: true,
  sources: {
    brushStateSnapshot: true,
    topLevelBuffers: false,
    legacyStateRefs: false,
  },
  ...overrides,
});

describe('ColorCycleLayerDocument', () => {
  it('reads a versioned frozen snapshot without exposing document-owned metadata for mutation', () => {
    const document = new ColorCycleLayerDocument(makeState(), { initialVersion: 3 });

    const read = document.read();

    expect(read.version).toBe(3);
    expect(read.snapshot.layerId).toBe('cc-layer');
    expect(Object.isFrozen(read.snapshot)).toBe(true);
    expect(Object.isFrozen(read.snapshot.sources)).toBe(true);
    expect(Object.isFrozen(read.snapshot.slotPalettes?.[0])).toBe(true);
    expect(readBytes(read.snapshot.paintBuffer)).toEqual([1, 0, 0, 0]);
  });

  it('keeps pre-commit reads stable while a transaction mutates its draft', () => {
    const document = new ColorCycleLayerDocument(makeState(), { initialVersion: 10 });
    const transaction = document.beginTransaction('stroke-commit');

    transaction.mutate((draft) => {
      new Uint8Array(draft.paintBuffer ?? new ArrayBuffer(0))[0] = 9;
      draft.hasContent = false;
    });

    const beforeCommit = document.read();
    expect(beforeCommit.version).toBe(10);
    expect(beforeCommit.snapshot.hasContent).toBe(true);
    expect(readBytes(beforeCommit.snapshot.paintBuffer)).toEqual([1, 0, 0, 0]);

    const afterCommit = transaction.commit();
    expect(afterCommit.version).toBe(11);
    expect(afterCommit.snapshot.hasContent).toBe(false);
    expect(readBytes(afterCommit.snapshot.paintBuffer)).toEqual([9, 0, 0, 0]);
  });

  it('bumps the version once per committed transaction and records the reason', () => {
    const document = new ColorCycleLayerDocument(makeState(), {
      initialVersion: 0,
      now: () => 1234,
    });
    const transaction = document.beginTransaction('shape-fill');

    transaction.mutate((draft) => {
      draft.paintSlot = 2;
    });
    transaction.mutate((draft) => {
      draft.fgActiveSlot = 2;
    });

    const read = transaction.commit();

    expect(read.version).toBe(1);
    expect(read.snapshot.paintSlot).toBe(2);
    expect(read.snapshot.fgActiveSlot).toBe(2);
    expect(document.getAuditLog()).toEqual([{
      reason: 'shape-fill',
      versionBefore: 0,
      versionAfter: 1,
      committedAtMs: 1234,
    }]);
  });

  it('replaces state with one version bump while keeping ownership of committed buffers', () => {
    const nextState = makeState({
      layerId: 'published-layer',
      paintBuffer: makeBuffer([7, 0, 0, 0]),
      slotPalettes: [{
        slot: 2,
        stops: [
          { position: 0, color: '#ff0000' },
          { position: 1, color: '#00ff00' },
        ],
      }],
      hasContent: false,
    });
    const document = new ColorCycleLayerDocument(makeState(), {
      initialVersion: 7,
      now: () => 4567,
    });

    const read = document.replaceState(nextState, 'stroke-publish');

    expect(read.version).toBe(8);
    expect(read.snapshot.layerId).toBe('published-layer');
    expect(read.snapshot.hasContent).toBe(false);
    expect(readBytes(read.snapshot.paintBuffer)).toEqual([7, 0, 0, 0]);
    expect(document.getAuditLog()).toEqual([{
      reason: 'stroke-publish',
      versionBefore: 7,
      versionAfter: 8,
      committedAtMs: 4567,
    }]);
    expect(document.consumeDirtyBatch()).toEqual({
      layerId: 'published-layer',
      version: 8,
      rects: [{ x: 0, y: 0, width: 2, height: 2 }],
    });

    new Uint8Array(nextState.paintBuffer ?? new ArrayBuffer(0))[0] = 9;
    nextState.slotPalettes?.[0]?.stops.push({ position: 0.5, color: '#0000ff' });

    const stableRead = document.read();
    expect(readBytes(stableRead.snapshot.paintBuffer)).toEqual([7, 0, 0, 0]);
    expect(stableRead.snapshot.slotPalettes?.[0]?.stops).toEqual([
      { position: 0, color: '#ff0000' },
      { position: 1, color: '#00ff00' },
    ]);
  });

  it('does not bump the version when replacing with identical canonical state', () => {
    const document = new ColorCycleLayerDocument(makeState(), {
      initialVersion: 7,
      now: () => 4567,
    });
    const equivalentState = makeState();

    const read = document.replaceState(equivalentState, 'stroke-publish');

    expect(read.version).toBe(7);
    expect(document.getAuditLog()).toEqual([]);
    expect(document.consumeDirtyBatch()).toBeNull();
  });

  it('tracks pixel version separately from metadata-only document changes', () => {
    const document = new ColorCycleLayerDocument(makeState(), { initialVersion: 7 });
    const metadataOnly = makeState({ paintSlot: 2 });

    const metadataRead = document.replaceState(metadataOnly, 'metadata-update');

    expect(metadataRead.version).toBe(8);
    expect(metadataRead.pixelVersion).toBe(7);

    const pixelRead = document.replaceState(
      makeState({ paintSlot: 2, paintBuffer: makeBuffer([9, 0, 0, 0]) }),
      'paint-update',
    );

    expect(pixelRead.version).toBe(9);
    expect(pixelRead.pixelVersion).toBe(8);
  });

  it('records a versioned full-layer dirty batch for committed transactions', () => {
    const document = new ColorCycleLayerDocument(makeState(), { initialVersion: 4 });
    const transaction = document.beginTransaction('stroke-commit');

    transaction.mutate((draft) => {
      draft.paintSlot = 3;
    });
    transaction.commit();

    expect(document.peekDirtyBatch()).toEqual({
      layerId: 'cc-layer',
      version: 5,
      rects: [{ x: 0, y: 0, width: 2, height: 2 }],
    });
    expect(document.consumeDirtyBatch()).toEqual({
      layerId: 'cc-layer',
      version: 5,
      rects: [{ x: 0, y: 0, width: 2, height: 2 }],
    });
    expect(document.consumeDirtyBatch()).toBeNull();
  });

  it('uses transaction dirty rects when supplied', () => {
    const document = new ColorCycleLayerDocument(makeState(), { initialVersion: 1 });
    const transaction = document.beginTransaction('shape-fill');

    transaction.markDirtyRect({ x: 0.4, y: 1.2, width: 1.1, height: 0.8 });
    transaction.mutate((draft) => {
      draft.paintSlot = 3;
    });
    transaction.commit();

    expect(document.consumeDirtyBatch()).toEqual({
      layerId: 'cc-layer',
      version: 2,
      rects: [{ x: 0, y: 1, width: 2, height: 1 }],
    });
  });

  it('coalesces adjacent and overlapping dirty rects in committed batches', () => {
    const document = new ColorCycleLayerDocument(makeState(), { initialVersion: 1 });
    const transaction = document.beginTransaction('shape-fill');

    transaction.markDirtyRect({ x: 1, y: 1, width: 2, height: 2 });
    transaction.markDirtyRect({ x: 3, y: 1, width: 2, height: 2 });
    transaction.markDirtyRect({ x: 4, y: 2, width: 2, height: 2 });
    transaction.mutate((draft) => {
      draft.paintSlot = 3;
    });
    transaction.commit();

    expect(document.consumeDirtyBatch()).toEqual({
      layerId: 'cc-layer',
      version: 2,
      rects: [{ x: 1, y: 1, width: 5, height: 3 }],
    });
  });

  it('rolls back without changing state, version, or audit log', () => {
    const document = new ColorCycleLayerDocument(makeState(), { initialVersion: 5 });
    const transaction = document.beginTransaction('discarded-edit');

    transaction.mutate((draft) => {
      draft.paintSlot = 8;
    });
    transaction.rollback();

    const read = document.read();
    expect(read.version).toBe(5);
    expect(read.snapshot.paintSlot).toBe(1);
    expect(document.getAuditLog()).toEqual([]);
  });

  it('replaces the baseline without recording a mutation audit entry', () => {
    const document = new ColorCycleLayerDocument(makeState(), {
      initialVersion: 2,
      now: () => 1234,
    });
    document.replaceState(makeState({ hasContent: false }), 'project-load-restore');

    const read = document.replaceBaseline(makeState({
      layerId: 'restored-layer',
      hasContent: true,
      paintSlot: 4,
    }));

    expect(read.version).toBe(0);
    expect(read.snapshot.layerId).toBe('restored-layer');
    expect(read.snapshot.hasContent).toBe(true);
    expect(read.snapshot.paintSlot).toBe(4);
    expect(document.getAuditLog()).toEqual([]);
  });

  it('rejects missing transaction reasons and closed transaction reuse', () => {
    const document = new ColorCycleLayerDocument(makeState());

    expect(() => document.beginTransaction('')).toThrow(
      'Color-cycle document transactions require a reason',
    );

    const transaction = document.beginTransaction('stroke-commit');
    transaction.commit();

    expect(() => transaction.mutate(() => undefined)).toThrow(
      'Color-cycle document transaction is already closed',
    );
  });

  it('rebases version anchors without replacing state or clearing pending dirty rects', () => {
    const document = new ColorCycleLayerDocument(makeState(), {
      initialVersion: 5,
      initialPixelVersion: 5,
    });
    document.replaceState(makeState({ hasContent: true }), 'stroke-commit', {
      dirtyRects: [{ x: 1, y: 1, width: 2, height: 2 }],
      force: true,
      pixelsChanged: true,
    });

    const read = document.rebaseVersionAnchors({ version: 3, pixelVersion: 2 });

    expect(read.version).toBe(3);
    expect(read.pixelVersion).toBe(2);
    expect(read.snapshot.hasContent).toBe(true);
    expect(document.peekDirtyBatch()).toEqual({
      layerId: 'cc-layer',
      version: 6,
      rects: [{ x: 1, y: 1, width: 2, height: 2 }],
    });
  });

  it('detects derived surfaces that were not built from the current document version', () => {
    const document = new ColorCycleLayerDocument(makeState(), { initialVersion: 2 });
    const surface: DerivedSurface = {
      builtFromVersion: null,
      rebuild(snapshot, version) {
        expect(snapshot.layerId).toBe('cc-layer');
        this.builtFromVersion = version;
      },
    };

    expect(isDerivedSurfaceStale(document, surface)).toBe(true);
    surface.rebuild(document.read().snapshot, document.version);
    expect(isDerivedSurfaceStale(document, surface)).toBe(false);

    const transaction = document.beginTransaction('stroke-commit');
    transaction.mutate((draft) => {
      draft.paintSlot = 2;
    });
    transaction.commit();

    expect(isDerivedSurfaceStale(document, surface)).toBe(true);
  });

  it('warns once when rendering a stale derived surface without a scheduled rebuild', () => {
    const document = new ColorCycleLayerDocument(makeState(), { initialVersion: 5 });
    const surface: DerivedSurface = {
      builtFromVersion: 4,
      rebuild(snapshot, version) {
        expect(snapshot.layerId).toBe('cc-layer');
        this.builtFromVersion = version;
      },
    };
    const warnSpy = jest.mocked(debugWarn);
    warnSpy.mockClear();

    expect(assertDerivedSurfaceFreshForRender({
      document,
      surface,
      label: 'test-surface',
      now: () => 10_000,
    })).toBe(false);
    expect(assertDerivedSurfaceFreshForRender({
      document,
      surface,
      label: 'test-surface',
      now: () => 10_500,
    })).toBe(false);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'ColorCycleDocument',
      'stale derived surface render',
      {
        label: 'test-surface',
        builtFromVersion: 4,
        documentVersion: 5,
      },
    );

  });

  it('does not warn for fresh surfaces or surfaces with a scheduled rebuild', () => {
    const document = new ColorCycleLayerDocument(makeState(), { initialVersion: 5 });
    const warnSpy = jest.mocked(debugWarn);
    warnSpy.mockClear();

    expect(assertDerivedSurfaceFreshForRender({
      document,
      surface: { builtFromVersion: 5 },
      label: 'fresh-surface',
      now: () => 20_000,
    })).toBe(true);
    expect(assertDerivedSurfaceFreshForRender({
      document,
      surface: { builtFromVersion: 4 },
      label: 'scheduled-surface',
      hasScheduledRebuild: true,
      now: () => 20_000,
    })).toBe(false);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('derives runtime policy from residency and complete canonical buffers', () => {
    const resident = new ColorCycleLayerDocument(makeState());
    expect(resident.runtimePolicy).toEqual({
      hasEditableSource: true,
      hasRuntimeRestoreSource: true,
      hasPlaybackWarmupSource: true,
      isPreviewOnly: false,
    });

    const previewOnly = new ColorCycleLayerDocument(makeState(), {
      residency: 'static-preview-only',
    });
    expect(previewOnly.runtimePolicy).toEqual({
      hasEditableSource: false,
      hasRuntimeRestoreSource: false,
      hasPlaybackWarmupSource: false,
      isPreviewOnly: true,
    });

    const incompleteCold = new ColorCycleLayerDocument(makeState({
      paintBuffer: undefined,
    }), {
      residency: 'cold-archive-ref',
    });
    expect(incompleteCold.runtimePolicy).toEqual({
      hasEditableSource: false,
      hasRuntimeRestoreSource: false,
      hasPlaybackWarmupSource: true,
      isPreviewOnly: true,
    });

    const coldWithArchiveRefs = new ColorCycleLayerDocument(makeState({
      paintBuffer: undefined,
      gradientIdBuffer: undefined,
      gradientDefIdBuffer: undefined,
      speedBuffer: undefined,
      flowBuffer: undefined,
      phaseBuffer: undefined,
    }), {
      residency: 'cold-archive-ref',
      archiveRefs: {
        paintRef: 'buffers/color-cycle/cc-layer/paint.bin',
        gradientIdRef: 'buffers/color-cycle/cc-layer/gid.bin',
      },
    });
    expect(coldWithArchiveRefs.runtimePolicy).toEqual({
      hasEditableSource: true,
      hasRuntimeRestoreSource: true,
      hasPlaybackWarmupSource: true,
      isPreviewOnly: false,
    });
  });

  it('bumps the document version when residency changes', () => {
    const document = new ColorCycleLayerDocument(makeState(), {
      initialVersion: 4,
      now: () => 5678,
    });

    const unchanged = document.replaceResidency('resident');
    expect(unchanged.version).toBe(4);
    expect(document.getAuditLog()).toEqual([]);

    const changed = document.replaceResidency('cold-archive-ref', 'project-load-restore');

    expect(document.residency).toBe('cold-archive-ref');
    expect(changed.version).toBe(5);
    expect(document.getAuditLog()).toEqual([{
      reason: 'project-load-restore',
      versionBefore: 4,
      versionAfter: 5,
      committedAtMs: 5678,
    }]);
  });

  it('tracks archive refs as part of cold residency changes', () => {
    const document = new ColorCycleLayerDocument(makeState(), {
      initialVersion: 8,
      now: () => 6789,
    });

    const read = document.replaceResidency('cold-archive-ref', {
      reason: 'project-load-restore',
      archiveRefs: {
        paintRef: 'paint.bin',
        speedRef: 'speed.bin',
      },
    });

    expect(read.version).toBe(9);
    expect(document.residency).toBe('cold-archive-ref');
    expect(document.archiveRefs).toEqual({
      paintRef: 'paint.bin',
      speedRef: 'speed.bin',
    });
    expect(document.runtimePolicy.hasRuntimeRestoreSource).toBe(true);
    expect(document.getAuditLog()).toEqual([expect.objectContaining({
      reason: 'project-load-restore',
      versionBefore: 8,
      versionAfter: 9,
      committedAtMs: 6789,
    })]);

    document.replaceResidency('resident', {
      reason: 'project-load-restore',
      archiveRefs: null,
    });

    expect(document.residency).toBe('resident');
    expect(document.archiveRefs).toBeNull();
  });

  it('keeps owner-attached layer documents isolated and clearable', () => {
    const ownerA = {};
    const ownerB = {};
    const documentA = new ColorCycleLayerDocument(makeState({ layerId: 'layer-a' }));
    const documentB = new ColorCycleLayerDocument(makeState({ layerId: 'layer-b' }));

    setColorCycleLayerDocumentForOwner(ownerA, 'layer-a', documentA);
    setColorCycleLayerDocumentForOwner(ownerB, 'layer-a', documentB);

    expect(hasColorCycleLayerDocumentForOwner(ownerA, 'layer-a')).toBe(true);
    expect(getColorCycleLayerDocumentForOwner(ownerA, 'layer-a')).toBe(documentA);
    expect(getColorCycleLayerDocumentForOwner(ownerB, 'layer-a')).toBe(documentB);

    deleteColorCycleLayerDocumentForOwner(ownerA, 'layer-a');
    expect(hasColorCycleLayerDocumentForOwner(ownerA, 'layer-a')).toBe(false);
    expect(getColorCycleLayerDocumentForOwner(ownerB, 'layer-a')).toBe(documentB);

    clearColorCycleLayerDocumentsForOwner(ownerB);
    expect(getColorCycleLayerDocumentForOwner(ownerB, 'layer-a')).toBeUndefined();
  });

  it('resolves owner-attached layer documents through explicit aliases', () => {
    const publicOwner = {};
    const storageOwner = {};
    const document = new ColorCycleLayerDocument(makeState({ layerId: 'layer-a' }));

    registerColorCycleLayerDocumentOwnerAlias(publicOwner, storageOwner);
    setColorCycleLayerDocumentForOwner(storageOwner, 'layer-a', document);

    expect(hasColorCycleLayerDocumentForOwner(publicOwner, 'layer-a')).toBe(true);
    expect(getColorCycleLayerDocumentForOwner(publicOwner, 'layer-a')).toBe(document);

    deleteColorCycleLayerDocumentForOwner(publicOwner, 'layer-a');
    expect(getColorCycleLayerDocumentForOwner(storageOwner, 'layer-a')).toBeUndefined();
  });
});
