import { buildGobletColorCyclePayload } from '@/utils/export/goblet/colorCyclePayloadBuilder';
import { resolveGobletColorCycleExportSource } from '@/utils/export/goblet/colorCycleExportSourceResolver';
import {
  captureGobletColorCyclePersistenceSnapshot,
  serializeColorCycleDataFromResolvedLayer,
} from '@/utils/export/goblet/gobletColorCycleSerializer';
import { validateGobletColorCyclePayload } from '@/utils/export/goblet/colorCyclePayloadValidation';
import * as colorCycleBrushManager from '@/stores/colorCycleBrushManager';
import { decodeColorCycleSpeedByte, encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';
import { localDitherPatternRegistry } from '@/utils/ditherPatterns/ditherPatternRegistry';
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

const createLiveRuntime = (
  indexValues = [1, 2, 3, 4],
  settings: Record<string, unknown> = {},
) => ({
  serialize: jest.fn(() => ({
    ...settings,
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

const createDocumentSnapshot = (paintValues = [1, 2, 3, 4]) => ({
  layerId: 'cc-layer',
  width: 2,
  height: 2,
  paintBuffer: Uint8Array.from(paintValues).buffer,
  gradientIdBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
  gradientDefIdBuffer: new Uint16Array([1, 1, 1, 1]).buffer,
  speedBuffer: Uint8Array.from([128, 128, 128, 128]).buffer,
  flowBuffer: Uint8Array.from([1, 1, 1, 1]).buffer,
  phaseBuffer: Uint8Array.from([0, 64, 128, 192]).buffer,
  hasContent: true,
  sources: {
    brushStateSnapshot: false,
    topLevelBuffers: false,
    legacyStateRefs: false,
  },
});

const createDocumentBackedLiveRuntime = (settings: Record<string, unknown>) => ({
  ...createLiveRuntime([1, 2, 3, 4], settings),
  getColorCycleLayerDocument: () => ({
    read: () => ({
      snapshot: createDocumentSnapshot(),
      version: 1,
      pixelVersion: 1,
    }),
  }),
});

describe('Goblet color-cycle export contract boundaries', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    localDitherPatternRegistry.clear();
  });

  it('selects canonical persisted source before direct live runtime when no document exists', async () => {
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
    expect(liveRuntime.serialize).not.toHaveBeenCalled();
  });

  it('falls back to direct live runtime when persisted buffers are not canonical', async () => {
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
    expect(liveRuntime.serialize).toHaveBeenCalled();
  });

  it('falls back to direct live runtime for warm archive state without exportable persisted data', async () => {
    const liveRuntime = createLiveRuntime();
    const result = await resolveGobletColorCycleExportSource(createLayer({
      runtimeHydrationState: 'warm',
      colorCycleBrush: liveRuntime as never,
    }), project);

    expect(result.ok ? result.source : undefined).toBe('live-runtime');
    expect(liveRuntime.serialize).toHaveBeenCalled();
  });

  it('rejects manager-backed live runtime through payload construction when no document exists', async () => {
    const liveRuntime = createLiveRuntime();
    jest.spyOn(colorCycleBrushManager, 'getColorCycleBrushManager').mockReturnValue({
      getBrush: jest.fn(() => liveRuntime),
    } as never);
    const payload = await buildGobletColorCyclePayload(createLayer({
      colorCycleBrush: undefined,
    }), project, {
      serializeResolvedLayer: serializeColorCycleDataFromResolvedLayer,
    });

    expect(payload.ok).toBe(false);
    expect(payload.ok ? undefined : payload.reason).toBe('missing-color-cycle-document');
    expect(liveRuntime.serialize).not.toHaveBeenCalled();
  });

  it('uses manager-owned documents through payload construction without recapturing live runtime', async () => {
    const liveRuntime = createLiveRuntime([9, 9, 9, 9]);
    const documentSnapshot = createDocumentSnapshot([1, 2, 3, 4]);
    jest.spyOn(colorCycleBrushManager, 'getColorCycleBrushManager').mockReturnValue({
      getDocument: jest.fn(() => ({
        read: () => ({
          snapshot: documentSnapshot,
          version: 31,
        }),
      })),
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

    expect(payload.ok ? payload.source : undefined).toBe('document');
    expect(liveRuntime.serialize).not.toHaveBeenCalled();
    if (payload.ok) {
      const indexBuffer = payload.payload.colorCycle?.brushState?.indexBuffer as ArrayLike<number>;
      expect(Array.from(indexBuffer)).toEqual([1, 2, 3, 4]);
      (indexBuffer as { [index: number]: number })[0] = 99;
      expect(Array.from(new Uint8Array(documentSnapshot.paintBuffer))).toEqual([1, 2, 3, 4]);
    }
  });

  it('does not retry live runtime when a document payload validates as empty paint', async () => {
    const liveRuntime = createLiveRuntime([5, 6, 7, 8]);
    const payload = await buildGobletColorCyclePayload(createLayer({
      colorCycleBrush: {
        serialize: liveRuntime.serialize,
        getColorCycleLayerDocument: () => ({
          read: () => ({
            snapshot: createDocumentSnapshot([0, 0, 0, 0]),
            version: 32,
          }),
        }),
      } as never,
      brushState: {
        canonicalPaint: true,
        schemaVersion: 1,
        layers: [{
          layerId: 'cc-layer',
          strokeData: {
            ...createCompleteStrokeData(),
            paintBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
          },
        }],
      },
    }), project, {
      serializeResolvedLayer: serializeColorCycleDataFromResolvedLayer,
    });

    expect(payload.ok).toBe(false);
    expect(payload.ok ? undefined : payload.reason).toBe('empty-paint-with-content');
    expect(liveRuntime.serialize).not.toHaveBeenCalled();
    expect(payload.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'empty-paint-with-content' }),
    ]));
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

  it('folds gradient stop opacity into Goblet colors', async () => {
    const transparentStop = {
      position: 0.5,
      color: '#fff200',
      opacity: 0.25,
    } as { position: number; color: string } & { opacity: number };
    const transparentStops = [
      { position: 0, color: '#b7ff00' },
      transparentStop,
      { position: 1, color: '#7fff00' },
    ];
    const layer = createLayer({
      slotPalettes: [{
        slot: 0,
        stops: transparentStops,
      }],
      gradientDefStore: [{
        id: 1,
        kind: 'linear',
        stops: transparentStops,
        hash: 'transparent-def',
        source: 'manual',
        createdAtMs: 0,
        slot: 0,
      }],
      brushState: {
        canonicalPaint: true,
        schemaVersion: 1,
        layers: [{
          layerId: 'cc-layer',
          strokeData: createCompleteStrokeData(),
        }],
      },
    });

    const payload = await serializeColorCycleDataFromResolvedLayer(layer, project);

    expect(payload?.colorCycle?.gradientDefStore?.[0]?.stops[1]).toEqual({
      position: 0.5,
      color: 'rgba(255, 242, 0, 0.25)',
    });
    expect(payload?.colorCycle?.slotPalettes?.[0]?.stops[1]).toEqual({
      position: 0.5,
      color: 'rgba(255, 242, 0, 0.25)',
    });
  });

  it('uses persisted write speed when hydrated archive motion buffers are missing', async () => {
    const persistedWriteSpeed = 0.35;
    const layerMultiplier = 2;
    const layer = createLayer({
      colorCycleBrush: undefined,
      runtimeHydrationState: 'warm',
      layerBaseSpeedCps: layerMultiplier,
      brushState: {
        canonicalPaint: true,
        schemaVersion: 1,
        cycleSpeed: persistedWriteSpeed,
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

    expect(payload?.colorCycle?.speedMode).toBe('slot');
    expect(payload?.colorCycle?.slotSpeeds?.find((entry) => entry.slot === 0)?.speed)
      .toBeCloseTo(
        decodeColorCycleSpeedByte(
          encodeColorCycleSpeedByte(persistedWriteSpeed * layerMultiplier),
        ),
        5,
      );
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

  it('omits installed local-library pattern references from portable Goblet brush metadata', async () => {
    localDitherPatternRegistry.register({
      definition: {
        id: 'local-threshold',
        name: 'Local Threshold',
        kind: 'cumulative-threshold',
        width: 1,
        height: 1,
        coveragePolicy: 'local-tone',
        payloadHash: `sha256:${'0'.repeat(64)}`,
        storageScope: 'local-library',
      },
      thresholds: Uint8Array.from([0]),
    });
    const payload = await serializeColorCycleDataFromResolvedLayer(
      createLayer({
        colorCycleBrush: createLiveRuntime([1, 2, 3, 4], {
          stampDitherEnabled: true,
          stampDitherPatternStyle: 'image-tile',
          stampDitherPatternTileId: 'local-threshold',
        }) as never,
      }),
      project,
    );

    const portableBrushState = payload?.colorCycle?.brushState as unknown as Record<string, unknown>;
    expect(portableBrushState?.stampDitherPatternStyle).toBeUndefined();
    expect(portableBrushState?.stampDitherPatternTileId).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('Local Threshold');
  });

  it('removes the complete image-tile configuration from Goblet persistence snapshots', () => {
    const runtime = createDocumentBackedLiveRuntime({
      stampDitherEnabled: true,
      stampDitherAlgorithm: 'pattern',
      stampDitherPatternStyle: 'image-tile',
      stampDitherPatternTileId: 'local-threshold',
      stampDitherPatternTileScale: 2,
      stampDitherPatternTileInvert: true,
      stampDitherPatternTileThreshold: 0.42,
      stampDitherPatternTileOffsetX: 7,
      stampDitherPatternTileOffsetY: 9,
    });
    const snapshot = captureGobletColorCyclePersistenceSnapshot(
      createLayer({
        colorCycleBrush: runtime as never,
      }),
      project,
    );

    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) {
      throw new Error(snapshot.reason);
    }
    expect(snapshot.brushState.stampDitherPatternStyle).toBeUndefined();
    expect(snapshot.brushState.stampDitherPatternTileId).toBeUndefined();
    expect(snapshot.brushState.stampDitherPatternTileScale).toBeUndefined();
    expect(snapshot.brushState.stampDitherPatternTileInvert).toBeUndefined();
    expect(snapshot.brushState.stampDitherPatternTileThreshold).toBeUndefined();
    expect(snapshot.brushState.stampDitherPatternTileOffsetX).toBeUndefined();
    expect(snapshot.brushState.stampDitherPatternTileOffsetY).toBeUndefined();
  });

  it('preserves built-in pattern settings in Goblet persistence snapshots', () => {
    const snapshot = captureGobletColorCyclePersistenceSnapshot(
      createLayer({
        colorCycleBrush: createDocumentBackedLiveRuntime({
          stampDitherEnabled: true,
          stampDitherAlgorithm: 'pattern',
          stampDitherPatternStyle: 'dots',
          stampDitherPatternTileScale: 2,
          stampDitherPatternTileInvert: true,
          stampDitherPatternTileThreshold: 0.42,
          stampDitherPatternTileOffsetX: 7,
          stampDitherPatternTileOffsetY: 9,
        }) as never,
      }),
      project,
    );

    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) {
      throw new Error(snapshot.reason);
    }
    expect(snapshot.brushState.stampDitherPatternStyle).toBe('dots');
    expect(snapshot.brushState.stampDitherPatternTileId).toBeUndefined();
    expect(snapshot.brushState.stampDitherPatternTileScale).toBe(2);
    expect(snapshot.brushState.stampDitherPatternTileInvert).toBe(true);
    expect(snapshot.brushState.stampDitherPatternTileThreshold).toBe(0.42);
    expect(snapshot.brushState.stampDitherPatternTileOffsetX).toBe(7);
    expect(snapshot.brushState.stampDitherPatternTileOffsetY).toBe(9);
  });

  it('omits missing local-library pattern references from portable Goblet brush metadata', async () => {
    const payload = await serializeColorCycleDataFromResolvedLayer(
      createLayer({
        colorCycleBrush: createLiveRuntime([1, 2, 3, 4], {
          stampDitherEnabled: true,
          stampDitherPatternStyle: 'image-tile',
          stampDitherPatternTileId: 'missing-local-threshold',
        }) as never,
      }),
      project,
    );

    const portableBrushState = payload?.colorCycle?.brushState as unknown as Record<string, unknown>;
    expect(portableBrushState?.stampDitherPatternStyle).toBeUndefined();
    expect(portableBrushState?.stampDitherPatternTileId).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('missing-local-threshold');
  });

  it('omits project-owned custom tile references because Goblet exports baked brush buffers', async () => {
    const projectWithCustomTile = {
      ...project,
      ccCustomTilePatterns: [{
        id: 'project-tile',
        name: 'Project Tile',
        width: 1,
        height: 1,
        rgbaBase64: 'AAAA/w==',
        createdAt: 1,
        updatedAt: 1,
      }],
    } as Project;
    const payload = await serializeColorCycleDataFromResolvedLayer(
      createLayer({
        colorCycleBrush: createLiveRuntime([1, 2, 3, 4], {
          stampDitherEnabled: true,
          stampDitherPatternStyle: 'image-tile',
          stampDitherPatternTileId: 'project-tile',
        }) as never,
      }),
      projectWithCustomTile,
    );

    const portableBrushState = payload?.colorCycle?.brushState as unknown as Record<string, unknown>;
    expect(portableBrushState?.stampDitherPatternStyle).toBeUndefined();
    expect(portableBrushState?.stampDitherPatternTileId).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('project-tile');
  });
});
