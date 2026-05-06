import { buildGobletColorCyclePayload } from '@/utils/export/goblet/colorCyclePayloadBuilder';
import { resolveGobletColorCycleExportSource } from '@/utils/export/goblet/colorCycleExportSourceResolver';
import { serializeColorCycleDataFromResolvedLayer } from '@/utils/export/goblet/gobletColorCycleSerializer';
import { validateGobletColorCyclePayload } from '@/utils/export/goblet/colorCyclePayloadValidation';
import * as colorCycleBrushManager from '@/stores/colorCycleBrushManager';
import * as projectIO from '@/utils/projectIO';
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

const createLiveRuntime = (indexValues = [1, 2, 3, 4]) => ({
  serialize: jest.fn(() => ({
    layers: [{
      layerId: 'cc-layer',
      data: {
        indexBuffer: {
          width: 2,
          height: 2,
          data: Uint8Array.from(indexValues),
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
});

describe('Goblet color-cycle export contract boundaries', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('selects canonical persisted source before live runtime', async () => {
    const liveRuntime = createLiveRuntime();
    const result = await resolveGobletColorCycleExportSource(createLayer({
      colorCycleBrush: liveRuntime as never,
      brushState: {
        canonicalPaint: true,
        schemaVersion: 1,
        layers: [{
          layerId: 'cc-layer',
          strokeData: createCompleteStrokeData(),
        }],
      },
    }), project);

    expect(result.ok ? result.source : undefined).toBe('persisted-brush-state');
  });

  it('falls back to live runtime when persisted buffers are not canonical', async () => {
    const liveRuntime = createLiveRuntime();
    const result = await resolveGobletColorCycleExportSource(createLayer({
      colorCycleBrush: liveRuntime as never,
      brushState: {
        layers: [{
          layerId: 'cc-layer',
          strokeData: createCompleteStrokeData(),
        }],
      },
    }), project);

    expect(result.ok ? result.source : undefined).toBe('live-runtime');
  });

  it('falls back to live runtime when archive hydration fails', async () => {
    jest.spyOn(projectIO, 'hydrateColorCycleArchiveRuntimeSnapshotForExport').mockRejectedValueOnce(new Error('stale archive ref'));
    const result = await resolveGobletColorCycleExportSource(createLayer({
      runtimeHydrationState: 'warm',
      colorCycleBrush: createLiveRuntime() as never,
    }), project);

    expect(result.ok ? result.source : undefined).toBe('live-runtime');
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing-archive-ref' }),
    ]));
  });

  it('uses manager-backed live runtime through payload construction', async () => {
    const liveRuntime = createLiveRuntime();
    jest.spyOn(colorCycleBrushManager, 'getColorCycleBrushManager').mockReturnValue({
      getBrush: jest.fn(() => liveRuntime),
    } as never);
    const payload = await buildGobletColorCyclePayload(createLayer({
      colorCycleBrush: undefined,
    }), project, {
      serializeResolvedLayer: serializeColorCycleDataFromResolvedLayer,
    });

    expect(payload.ok ? payload.source : undefined).toBe('live-runtime');
    expect(liveRuntime.serialize).toHaveBeenCalled();
  });

  it('does not recapture manager-backed live runtime for resolved persisted exports', async () => {
    const liveRuntime = createLiveRuntime([9, 9, 9, 9]);
    jest.spyOn(colorCycleBrushManager, 'getColorCycleBrushManager').mockReturnValue({
      getBrush: jest.fn(() => liveRuntime),
    } as never);
    const payload = await buildGobletColorCyclePayload(createLayer({
      colorCycleBrush: undefined,
      brushState: {
        canonicalPaint: true,
        schemaVersion: 1,
        layers: [{
          layerId: 'cc-layer',
          strokeData: createCompleteStrokeData(),
        }],
      },
    }), project, {
      serializeResolvedLayer: serializeColorCycleDataFromResolvedLayer,
    });

    expect(payload.ok ? payload.source : undefined).toBe('persisted-brush-state');
    expect(liveRuntime.serialize).not.toHaveBeenCalled();
    if (payload.ok) {
      const indexBuffer = payload.payload.colorCycle?.brushState?.indexBuffer as ArrayLike<number>;
      expect(Array.from(indexBuffer)).toEqual([1, 2, 3, 4]);
    }
  });

  it('lets resolved hydrated archive snapshots use persisted motion defaults without live recapture', async () => {
    const liveRuntime = createLiveRuntime([9, 9, 9, 9]);
    jest.spyOn(colorCycleBrushManager, 'getColorCycleBrushManager').mockReturnValue({
      getBrush: jest.fn(() => liveRuntime),
    } as never);
    const layer = createLayer({
      colorCycleBrush: undefined,
      runtimeHydrationState: 'warm',
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

    const payload = await serializeColorCycleDataFromResolvedLayer(
      layer,
      project,
      undefined,
      { resolvedSource: 'hydrated-archive-document-state' },
    );

    expect(payload).toBeDefined();
    expect(liveRuntime.serialize).not.toHaveBeenCalled();
    if (payload) {
      expect(payload.colorCycle?.brushState?.flowBuffer).toBeDefined();
      expect(payload.colorCycle?.brushState?.phaseBuffer).toBeDefined();
      expect(payload.colorCycle?.speedMode).toBe('slot');
      expect(payload.colorCycle?.brushState?.speedBuffer).toBeUndefined();
      const indexBuffer = payload.colorCycle?.brushState?.indexBuffer as ArrayLike<number>;
      expect(Array.from(indexBuffer)).toEqual([1, 2, 3, 4]);
    }
  });

  it('rejects missing required final payload buffers in validation', () => {
    const result = validateGobletColorCyclePayload({
      mode: 'brush',
      isAnimating: true,
      brushState: {
        width: 2,
        height: 2,
        indexBuffer: [1, 2, 3, 4],
        gradientIdBuffer: [0, 0, 0, 0],
        gradientDefIdBuffer: [1, 1, 1, 1],
        gradientStops: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        animationOffset: 0,
      },
    }, {
      layerId: 'cc-layer',
      hasContent: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing-required-buffer');
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'missing-required-buffer',
        message: expect.stringContaining('speedBuffer'),
      }),
    ]));
  });
});
