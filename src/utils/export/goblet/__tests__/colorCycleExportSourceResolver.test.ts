import { cloneGobletExportLayer, resolveGobletColorCycleExportSource } from '@/utils/export/goblet/colorCycleExportSourceResolver';
import { buildGobletColorCyclePayload } from '@/utils/export/goblet/colorCyclePayloadBuilder';
import { serializeColorCycleDataFromResolvedLayer } from '@/utils/export/goblet/gobletColorCycleSerializer';
import * as projectIO from '@/utils/projectIO';
import * as colorCycleBrushManager from '@/stores/colorCycleBrushManager';
import {
  attachLegacyColorCycleTopLevelBuffers,
  getColorCycleLegacyLayerBuffer,
} from '@/lib/colorCycle/document';
import type { Layer, Project } from '@/types';

const project = {
  id: 'project',
  name: 'Project',
  width: 2,
  height: 2,
  backgroundColor: '#000000',
  layers: [],
  layerGroups: [],
  activeLayerId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  version: '1.0.0',
} as unknown as Project;

const createLayer = (overrides: Partial<Layer['colorCycleData']> = {}): Layer => ({
  id: 'cc-layer',
  name: 'CC Layer',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  transparencyLocked: false,
  order: 0,
  imageData: null,
  framebuffer: { width: 2, height: 2 } as HTMLCanvasElement,
  alignment: {
    fit: 'none',
    horizontal: 'left',
    vertical: 'top',
    positioning: 'anchor',
  },
  layerType: 'color-cycle',
  colorCycleData: {
    mode: 'brush',
    isAnimating: true,
    hasContent: true,
    gradient: [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ],
    ...overrides,
  },
  version: 1,
});

const createCompleteStrokeData = () => ({
  paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
  gradientIdBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
  gradientDefIdBuffer: new Uint16Array([1, 1, 1, 1]).buffer,
  speedBuffer: Uint8Array.from([128, 128, 128, 128]).buffer,
  flowBuffer: Uint8Array.from([1, 1, 1, 1]).buffer,
  phaseBuffer: Uint8Array.from([0, 64, 128, 192]).buffer,
});

const createDefaultableStrokeData = () => ({
  paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
  gradientIdBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
  gradientDefIdBuffer: new Uint16Array([1, 1, 1, 1]).buffer,
});

const createDocumentSnapshot = () => ({
  layerId: 'cc-layer',
  width: 2,
  height: 2,
  paintBuffer: Uint8Array.from([5, 6, 7, 8]).buffer,
  gradientIdBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
  gradientDefIdBuffer: new Uint16Array([1, 1, 1, 1]).buffer,
  speedBuffer: Uint8Array.from([128, 128, 128, 128]).buffer,
  flowBuffer: Uint8Array.from([1, 1, 1, 1]).buffer,
  phaseBuffer: Uint8Array.from([0, 64, 128, 192]).buffer,
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
    kind: 'linear' as const,
    stops: [{ position: 0, color: '#000000' }],
    hash: 'hash-a',
    source: 'manual' as const,
    createdAtMs: 1,
    slot: 1,
  }],
  activeGradientId: 'def-a',
  paintSlot: 1,
  fgActiveSlot: 1,
  layerBaseSpeedCps: 1,
  flowMode: 'forward' as const,
  hasContent: true,
  sources: {
    brushStateSnapshot: false,
    topLevelBuffers: false,
    legacyStateRefs: false,
  },
});

const expectMissingDocument = (
  result: Awaited<ReturnType<typeof resolveGobletColorCycleExportSource>>,
) => {
  expect(result.ok).toBe(false);
  expect(result.ok ? undefined : result.reason).toBe('missing-color-cycle-document');
  expect(result.diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({
      code: 'missing-color-cycle-document',
      severity: 'error',
    }),
  ]));
};

describe('resolveGobletColorCycleExportSource', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exports persisted brush state when no document has been warmed and does not mutate the source layer', async () => {
    const strokeData = createCompleteStrokeData();
    const layer = createLayer({
      colorCycleBrush: { serialize: jest.fn() } as never,
      brushState: {
        canonicalPaint: true,
        schemaVersion: 1,
        layers: [{
          layerId: 'cc-layer',
          strokeData,
        }],
      },
    });
    const before = JSON.stringify(layer, (_key, value) => (
      value instanceof ArrayBuffer ? Array.from(new Uint8Array(value)) : value
    ));

    const result = await resolveGobletColorCycleExportSource(layer, project);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.source : undefined).toBe('persisted-brush-state');
    expect(JSON.stringify(layer, (_key, value) => (
      value instanceof ArrayBuffer ? Array.from(new Uint8Array(value)) : value
    ))).toBe(before);

    const payload = await buildGobletColorCyclePayload(layer, project, {
      serializeResolvedLayer: serializeColorCycleDataFromResolvedLayer,
    });

    expect(payload.ok).toBe(true);
    if (payload.ok) {
      expect(payload.source).toBe('persisted-brush-state');
      expect(payload.payload.colorCycle?.brushState?.indexBuffer).toEqual([1, 2, 3, 4]);
    }
  });

  it('selects a pinned document snapshot before persisted or live sources and records the version in diagnostics', async () => {
    const layer = createLayer({
      colorCycleBrush: {
        serialize: jest.fn(),
        getColorCycleLayerDocument: () => ({
          read: () => ({
            snapshot: createDocumentSnapshot(),
            version: 12,
          }),
        }),
      } as never,
      brushState: {
        canonicalPaint: true,
        schemaVersion: 1,
        layers: [{
          layerId: 'cc-layer',
          strokeData: createCompleteStrokeData(),
        }],
      },
    });

    const source = await resolveGobletColorCycleExportSource(layer, project);

    expect(source.ok).toBe(true);
    expect(source.ok ? source.source : undefined).toBe('document');
    expect(source.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'document-source-selected',
        severity: 'info',
        message: expect.stringContaining('version 12'),
        documentVersion: 12,
      }),
    ]));
    if (source.ok) {
      const documentPaint = (
        source.layer.colorCycleData?.brushState as {
          layers?: Array<{ strokeData?: { paintBuffer?: ArrayBuffer } }>;
        } | undefined
      )?.layers?.[0]?.strokeData?.paintBuffer;
      expect(Array.from(new Uint8Array(documentPaint ?? new ArrayBuffer(0)))).toEqual([5, 6, 7, 8]);
    }

    const payload = await buildGobletColorCyclePayload(layer, project, {
      serializeResolvedLayer: serializeColorCycleDataFromResolvedLayer,
    });

    expect(payload.ok).toBe(true);
    if (payload.ok) {
      expect(payload.source).toBe('document');
      expect(payload.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'document-source-selected',
          message: expect.stringContaining('version 12'),
          documentVersion: 12,
        }),
      ]));
      expect(payload.payload.colorCycle?.brushState?.indexBuffer).toEqual([5, 6, 7, 8]);
    }
  });

  it('selects a manager-owned document before persisted or live sources', async () => {
    const getDocument = jest.fn(() => ({
      read: () => ({
        snapshot: createDocumentSnapshot(),
        version: 21,
      }),
    }));
    const liveRuntime = { serialize: jest.fn() };
    jest.spyOn(colorCycleBrushManager, 'getColorCycleBrushManager').mockReturnValue({
      getDocument,
      getBrush: jest.fn(() => liveRuntime),
    } as never);
    const layer = createLayer({
      colorCycleBrush: undefined,
      brushState: {
        canonicalPaint: true,
        schemaVersion: 1,
        layers: [{
          layerId: 'cc-layer',
          strokeData: createCompleteStrokeData(),
        }],
      },
    });

    const payload = await buildGobletColorCyclePayload(layer, project, {
      serializeResolvedLayer: serializeColorCycleDataFromResolvedLayer,
    });

    expect(payload.ok ? payload.source : undefined).toBe('document');
    expect(getDocument).toHaveBeenCalledWith('cc-layer');
    expect(liveRuntime.serialize).not.toHaveBeenCalled();
    if (payload.ok) {
      expect(payload.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'document-source-selected',
          documentVersion: 21,
        }),
      ]));
      expect(payload.payload.colorCycle?.brushState?.indexBuffer).toEqual([5, 6, 7, 8]);
    }
  });

  it('rejects unresolved cold manager documents instead of exporting placeholder buffers', async () => {
    const getDocument = jest.fn(() => ({
      residency: 'cold-archive-ref',
      archiveRefs: {
        paintRef: 'zip:buffers/color-cycle/cc-layer/paint.bin',
        gradientIdRef: 'zip:buffers/color-cycle/cc-layer/gradient-id.bin',
        gradientDefIdRef: 'zip:buffers/color-cycle/cc-layer/gradient-def-id.bin',
        speedRef: 'zip:buffers/color-cycle/cc-layer/speed.bin',
        flowRef: 'zip:buffers/color-cycle/cc-layer/flow.bin',
        phaseRef: 'zip:buffers/color-cycle/cc-layer/phase.bin',
      },
      read: () => ({
        snapshot: {
          ...createDocumentSnapshot(),
          paintBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
        },
        version: 22,
      }),
    }));
    jest.spyOn(colorCycleBrushManager, 'getColorCycleBrushManager').mockReturnValue({
      getDocument,
      getSerializedStateBrush: jest.fn(() => undefined),
    } as never);
    const layer = createLayer();

    const source = await resolveGobletColorCycleExportSource(layer, project);

    expectMissingDocument(source);
    expect(getDocument).toHaveBeenCalledWith('cc-layer');

    const payload = await buildGobletColorCyclePayload(layer, project, {
      serializeResolvedLayer: serializeColorCycleDataFromResolvedLayer,
    });

    expect(payload.ok).toBe(false);
    expect(payload.ok ? undefined : payload.reason).toBe('missing-color-cycle-document');
  });

  it('exports warm persisted archive state without requiring a document', async () => {
    const layer = createLayer({
      runtimeHydrationState: 'warm',
      brushState: {
        canonicalPaint: true,
        schemaVersion: 1,
        layers: [{
          layerId: 'cc-layer',
          strokeData: createCompleteStrokeData(),
        }],
      },
    });

    const result = await resolveGobletColorCycleExportSource(layer, project);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.source : undefined).toBe('persisted-brush-state');

    const payload = await buildGobletColorCyclePayload(layer, project, {
      serializeResolvedLayer: serializeColorCycleDataFromResolvedLayer,
    });

    expect(payload.ok).toBe(true);
    if (payload.ok) {
      expect(payload.source).toBe('persisted-brush-state');
      expect(payload.payload.colorCycle?.brushState?.indexBuffer).toEqual([1, 2, 3, 4]);
    }
  });

  it('exports defaultable persisted brush state without a document', async () => {
    const layer = createLayer({
      brushSpeed: 0.5,
      brushState: {
        canonicalPaint: true,
        schemaVersion: 1,
        layers: [{
          layerId: 'cc-layer',
          strokeData: createDefaultableStrokeData(),
        }],
      },
    });

    const source = await resolveGobletColorCycleExportSource(layer, project);

    expect(source.ok).toBe(true);
    expect(source.ok ? source.source : undefined).toBe('persisted-brush-state');

    const payload = await buildGobletColorCyclePayload(layer, project, {
      serializeResolvedLayer: serializeColorCycleDataFromResolvedLayer,
    });

    expect(payload.ok).toBe(true);
    if (payload.ok) {
      expect(payload.source).toBe('persisted-brush-state');
      expect(payload.payload.colorCycle?.brushState?.indexBuffer).toEqual([1, 2, 3, 4]);
      expect(payload.payload.colorCycle?.brushState?.flowBuffer).toBeDefined();
      expect(payload.payload.colorCycle?.brushState?.phaseBuffer).toBeDefined();
    }
  });

  it('exports cold archive state through export-local hydration before live runtime fallback', async () => {
    const liveRuntime = { serialize: jest.fn() };
    const layer = createLayer({
      runtimeHydrationState: 'cold',
      deferredRuntimeRestore: true,
      colorCycleBrush: liveRuntime as never,
    });
    jest.spyOn(projectIO, 'hydrateColorCycleArchiveRuntimeSnapshotForExport').mockResolvedValue(createLayer({
      runtimeHydrationState: 'warm',
      deferredRuntimeRestore: false,
      colorCycleBrush: undefined,
      brushState: {
        canonicalPaint: true,
        schemaVersion: 1,
        layers: [{
          layerId: 'cc-layer',
          strokeData: createCompleteStrokeData(),
        }],
      },
    }));

    const result = await resolveGobletColorCycleExportSource(layer, project);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.source : undefined).toBe('hydrated-archive-document-state');
    expect(projectIO.hydrateColorCycleArchiveRuntimeSnapshotForExport).toHaveBeenCalledWith(layer);
    expect(liveRuntime.serialize).not.toHaveBeenCalled();

    const payload = await buildGobletColorCyclePayload(layer, project, {
      serializeResolvedLayer: serializeColorCycleDataFromResolvedLayer,
    });

    expect(payload.ok).toBe(true);
    if (payload.ok) {
      expect(payload.source).toBe('hydrated-archive-document-state');
      expect(payload.payload.colorCycle?.brushState?.indexBuffer).toEqual([1, 2, 3, 4]);
    }
  });

  it('rejects warm archive state without source data when no document exists', async () => {
    const layer = createLayer({
      runtimeHydrationState: 'warm',
    });
    jest.spyOn(projectIO, 'hydrateColorCycleArchiveRuntimeSnapshotForExport').mockResolvedValueOnce({
      ...layer,
      colorCycleData: {
        ...layer.colorCycleData!,
        colorCycleBrush: undefined,
      },
    });

    const result = await resolveGobletColorCycleExportSource(layer, project);

    expectMissingDocument(result);
    expect(projectIO.hydrateColorCycleArchiveRuntimeSnapshotForExport).not.toHaveBeenCalled();
  });

  it('rejects incomplete persisted stroke data without a document', async () => {
    const layer = createLayer({
      brushState: {
        canonicalPaint: true,
        schemaVersion: 1,
        layers: [{
          layerId: 'cc-layer',
          strokeData: {
            paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
          },
        }],
      },
    });

    const result = await resolveGobletColorCycleExportSource(layer, project);

    expectMissingDocument(result);
  });

  it('rejects persisted stroke data missing gradient buffers without a document', async () => {
    const layer = createLayer({
      brushState: {
        canonicalPaint: true,
        schemaVersion: 1,
        layers: [{
          layerId: 'cc-layer',
          strokeData: {
            paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
            speedBuffer: Uint8Array.from([128, 128, 128, 128]).buffer,
            flowBuffer: Uint8Array.from([1, 1, 1, 1]).buffer,
            phaseBuffer: Uint8Array.from([0, 64, 128, 192]).buffer,
          },
        }],
      },
    });

    const result = await resolveGobletColorCycleExportSource(layer, project);

    expectMissingDocument(result);
  });

  it('rejects non-canonical persisted stroke data without a document', async () => {
    const layer = createLayer({
      brushState: {
        layers: [{
          layerId: 'cc-layer',
          strokeData: createCompleteStrokeData(),
        }],
      },
    });

    const result = await resolveGobletColorCycleExportSource(layer, project);

    expectMissingDocument(result);
  });

  it('rejects persisted stroke data with an unsupported schema version without a document', async () => {
    const layer = createLayer({
      brushState: {
        canonicalPaint: true,
        schemaVersion: 999,
        layers: [{
          layerId: 'cc-layer',
          strokeData: createCompleteStrokeData(),
        }],
      },
    });

    const result = await resolveGobletColorCycleExportSource(layer, project);

    expectMissingDocument(result);
  });

  it('rejects manager-backed live runtime when the manager has no document', async () => {
    const liveRuntime = {
      serialize: jest.fn(() => ({
        layers: [{
          layerId: 'cc-layer',
          data: {
            indexBuffer: {
              width: 2,
              height: 2,
              data: Uint8Array.from([1, 2, 3, 4]),
              gradientId: Uint8Array.from([0, 0, 0, 0]),
              speedData: Uint8Array.from([128, 128, 128, 128]),
              flowData: Uint8Array.from([1, 1, 1, 1]),
              phaseData: Uint8Array.from([0, 64, 128, 192]),
            },
            gradient: {
              gradientStops: [
                { position: 0, color: '#000000' },
                { position: 1, color: '#ffffff' },
              ],
            },
          },
        }],
      })),
    };
    jest.spyOn(colorCycleBrushManager, 'getColorCycleBrushManager').mockReturnValue({
      getBrush: jest.fn(() => liveRuntime),
    } as never);
    const layer = createLayer({
      colorCycleBrush: undefined,
    });

    const result = await resolveGobletColorCycleExportSource(layer, project);

    expectMissingDocument(result);

    const payload = await buildGobletColorCyclePayload(layer, project, {
      serializeResolvedLayer: serializeColorCycleDataFromResolvedLayer,
    });

    expect(payload.ok).toBe(false);
    expect(payload.ok ? undefined : payload.reason).toBe('missing-color-cycle-document');
    expect(liveRuntime.serialize).not.toHaveBeenCalled();
  });

  it('returns a failed result when no CC source data exists', async () => {
    const result = await resolveGobletColorCycleExportSource(createLayer(), project);

    expectMissingDocument(result);
  });

  it('clones canonical buffers for export-local mutation', () => {
    const gradientIdBuffer = Uint8Array.from([1, 2, 3, 4]).buffer;
    const layer = createLayer();
    layer.colorCycleData = attachLegacyColorCycleTopLevelBuffers(layer.colorCycleData ?? {}, { gradientIdBuffer });
    const clone = cloneGobletExportLayer(layer);
    const clonedGradientIdBuffer = getColorCycleLegacyLayerBuffer(clone.colorCycleData, 'gradientIdBuffer');

    expect(clonedGradientIdBuffer).not.toBe(gradientIdBuffer);
    expect(Array.from(new Uint8Array(clonedGradientIdBuffer ?? new ArrayBuffer(0)))).toEqual([1, 2, 3, 4]);
  });
});
