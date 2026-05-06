import { cloneGobletExportLayer, resolveGobletColorCycleExportSource } from '@/utils/export/goblet/colorCycleExportSourceResolver';
import { buildGobletColorCyclePayload } from '@/utils/export/goblet/colorCyclePayloadBuilder';
import { serializeColorCycleDataFromResolvedLayer } from '@/utils/export/goblet/gobletColorCycleSerializer';
import * as projectIO from '@/utils/projectIO';
import * as colorCycleBrushManager from '@/stores/colorCycleBrushManager';
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
  gradientDefIdBuffer: Uint8Array.from([1, 1, 1, 1]).buffer,
  speedBuffer: Uint8Array.from([128, 128, 128, 128]).buffer,
  flowBuffer: Uint8Array.from([1, 1, 1, 1]).buffer,
  phaseBuffer: Uint8Array.from([0, 64, 128, 192]).buffer,
});

const createDefaultableStrokeData = () => ({
  paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
  gradientIdBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
  gradientDefIdBuffer: new Uint16Array([1, 1, 1, 1]).buffer,
});

describe('resolveGobletColorCycleExportSource', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('selects persisted brush state before live runtime and does not mutate the source layer', async () => {
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
    if (result.ok) {
      const clonedBrushState = result.layer.colorCycleData?.brushState as {
        layers?: Array<{ strokeData?: { paintBuffer?: ArrayBuffer } }>;
      } | undefined;
      const clonedPaint = clonedBrushState?.layers?.[0]?.strokeData?.paintBuffer;
      expect(clonedPaint).not.toBe(strokeData.paintBuffer);
    }
  });

  it('falls back to persisted brush state after archive hydration fails', async () => {
    jest.spyOn(projectIO, 'hydrateColorCycleArchiveRuntimeSnapshotForExport').mockRejectedValueOnce(new Error('stale archive ref'));
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
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'missing-archive-ref',
        severity: 'warning',
        message: 'stale archive ref',
      }),
    ]));
  });

  it('selects persisted brush state with defaultable motion buffers and builds a valid payload', async () => {
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
      expect(payload.payload.colorCycle?.brushState?.flowBuffer).toBeDefined();
      expect(payload.payload.colorCycle?.brushState?.phaseBuffer).toBeDefined();
      expect(payload.payload.colorCycle?.speedMode).toBe('slot');
      expect(payload.payload.colorCycle?.brushState?.speedBuffer).toBeUndefined();
    }
  });

  it('falls back to live runtime after archive hydration fails', async () => {
    jest.spyOn(projectIO, 'hydrateColorCycleArchiveRuntimeSnapshotForExport').mockRejectedValueOnce(new Error('stale archive ref'));
    const liveRuntime = { serialize: jest.fn() };
    const layer = createLayer({
      runtimeHydrationState: 'cold',
      colorCycleBrush: liveRuntime as never,
    });

    const result = await resolveGobletColorCycleExportSource(layer, project);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.source : undefined).toBe('live-runtime');
    expect(result.ok ? result.layer.colorCycleData?.colorCycleBrush : undefined).toBe(liveRuntime);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'missing-archive-ref',
        severity: 'warning',
        message: 'stale archive ref',
      }),
      expect.objectContaining({
        code: 'live-runtime-source-selected',
      }),
    ]));
  });

  it('uses live runtime when warm archive hydration does not materialize a snapshot', async () => {
    const liveRuntime = { serialize: jest.fn() };
    const layer = createLayer({
      runtimeHydrationState: 'warm',
      colorCycleBrush: liveRuntime as never,
    });
    jest.spyOn(projectIO, 'hydrateColorCycleArchiveRuntimeSnapshotForExport').mockResolvedValueOnce({
      ...layer,
      colorCycleData: {
        ...layer.colorCycleData!,
        colorCycleBrush: undefined,
      },
    });

    const result = await resolveGobletColorCycleExportSource(layer, project);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.source : undefined).toBe('live-runtime');
    expect(result.ok ? result.layer.colorCycleData?.colorCycleBrush : undefined).toBe(liveRuntime);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'archive-hydration-empty',
        severity: 'warning',
      }),
      expect.objectContaining({
        code: 'live-runtime-source-selected',
      }),
    ]));
  });

  it('uses live runtime when same-layer persisted stroke data is incomplete', async () => {
    const liveRuntime = { serialize: jest.fn() };
    const layer = createLayer({
      colorCycleBrush: liveRuntime as never,
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

    expect(result.ok).toBe(true);
    expect(result.ok ? result.source : undefined).toBe('live-runtime');
    expect(result.ok ? result.layer.colorCycleData?.colorCycleBrush : undefined).toBe(liveRuntime);
  });

  it('uses live runtime when persisted stroke data is missing gradient buffers', async () => {
    const liveRuntime = { serialize: jest.fn() };
    const layer = createLayer({
      colorCycleBrush: liveRuntime as never,
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

    expect(result.ok).toBe(true);
    expect(result.ok ? result.source : undefined).toBe('live-runtime');
    expect(result.ok ? result.layer.colorCycleData?.colorCycleBrush : undefined).toBe(liveRuntime);
  });

  it('uses live runtime when persisted stroke data has buffers but is not canonical', async () => {
    const liveRuntime = { serialize: jest.fn() };
    const layer = createLayer({
      colorCycleBrush: liveRuntime as never,
      brushState: {
        layers: [{
          layerId: 'cc-layer',
          strokeData: createCompleteStrokeData(),
        }],
      },
    });

    const result = await resolveGobletColorCycleExportSource(layer, project);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.source : undefined).toBe('live-runtime');
    expect(result.ok ? result.layer.colorCycleData?.colorCycleBrush : undefined).toBe(liveRuntime);
  });

  it('uses live runtime when persisted stroke data has an unsupported schema version', async () => {
    const liveRuntime = { serialize: jest.fn() };
    const layer = createLayer({
      colorCycleBrush: liveRuntime as never,
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

    expect(result.ok).toBe(true);
    expect(result.ok ? result.source : undefined).toBe('live-runtime');
    expect(result.ok ? result.layer.colorCycleData?.colorCycleBrush : undefined).toBe(liveRuntime);
  });

  it('uses manager-backed live runtime when the layer does not hold a direct brush', async () => {
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

    expect(result.ok).toBe(true);
    expect(result.ok ? result.source : undefined).toBe('live-runtime');
    expect(result.ok ? result.layer.colorCycleData?.colorCycleBrush : undefined).toBeUndefined();

    const payload = await buildGobletColorCyclePayload(layer, project, {
      serializeResolvedLayer: serializeColorCycleDataFromResolvedLayer,
    });

    expect(payload.ok).toBe(true);
    expect(payload.ok ? payload.source : undefined).toBe('live-runtime');
    expect(liveRuntime.serialize).toHaveBeenCalled();
  });

  it('returns a failed result when no CC source data exists', async () => {
    const result = await resolveGobletColorCycleExportSource(createLayer(), project);

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.reason).toBe('missing-color-cycle-source');
  });

  it('clones canonical buffers for export-local mutation', () => {
    const gradientIdBuffer = Uint8Array.from([1, 2, 3, 4]).buffer;
    const clone = cloneGobletExportLayer(createLayer({ gradientIdBuffer }));

    expect(clone.colorCycleData?.gradientIdBuffer).not.toBe(gradientIdBuffer);
    expect(Array.from(new Uint8Array(clone.colorCycleData?.gradientIdBuffer as ArrayBuffer))).toEqual([1, 2, 3, 4]);
  });
});
