import { pointInPolygon } from '@/shapeFill/utils/geometry';
import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import { finalizeColorCycleShapeFillLinear } from '@/hooks/canvas/handlers/colorCycle/colorCycleShapeFill';
import {
  beginMarkGradientSession,
  finalizeMarkGradientSession,
  type MarkGradientSession,
} from '@/hooks/canvas/utils/colorCycleMarkSession';
import { ColorCycleBrushCanvas2D } from '../ColorCycleBrushCanvas2D';
import { decodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';
import { appendGradientSeamProfileSignature } from '@/lib/colorCycle/gradientSeamProfile';
import { hashStops, type StoredStop } from '@/utils/colorCycleGradientDefs';
import { useAppStore } from '@/stores/useAppStore';

type MockContext = CanvasRenderingContext2D & {
  _lastImageData?: ImageData;
  _hasDrawImage?: boolean;
};

const makeMockContext = (canvas: HTMLCanvasElement): MockContext => {
  const createImageData = (w: number, h: number) => ({
    data: new Uint8ClampedArray(Math.max(0, w * h * 4)),
    width: w,
    height: h,
  });
  const createDrawnImageData = (w: number, h: number) => {
    const imageData = createImageData(w, h);
    for (let i = 3; i < imageData.data.length; i += 4) {
      imageData.data[i] = 255;
    }
    return imageData;
  };
  const ctx = {
    canvas,
    imageSmoothingEnabled: false,
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    createImageData: jest.fn(createImageData),
    getImageData: jest.fn((x: number, y: number, w: number, h: number) =>
      ctx._hasDrawImage ? createDrawnImageData(w, h) : createImageData(w, h)
    ),
    putImageData: jest.fn(),
    clearRect: jest.fn(),
    drawImage: jest.fn(() => {
      ctx._hasDrawImage = true;
    }),
    setTransform: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    scale: jest.fn(),
    fillRect: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    rect: jest.fn(),
    clip: jest.fn(),
    createLinearGradient: jest.fn(() => ({ addColorStop: jest.fn() })),
  } as unknown as MockContext;
  return ctx;
};

const ensureMockContext = (canvas: HTMLCanvasElement): MockContext => {
  const anyCanvas = canvas as unknown as { __mockCtx?: MockContext };
  if (!anyCanvas.__mockCtx) {
    anyCanvas.__mockCtx = makeMockContext(canvas);
  }
  return anyCanvas.__mockCtx;
};

const makeCanvas = (width: number, height: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas as HTMLCanvasElement;
};

jest.mock('@/utils/canvasPool', () => ({
  canvasPool: {
    acquire: jest.fn((width: number, height: number) => makeCanvas(width, height)),
    release: jest.fn(),
  },
}));

type MockStoreState = {
  layers: Array<unknown>;
  tools: { brushSettings: Record<string, unknown> };
  updateLayer?: jest.Mock;
  setCcGradientSampleCount?: jest.Mock;
};

jest.mock('@/stores/useAppStore', () => {
  const state: MockStoreState = { layers: [], tools: { brushSettings: {} } };
  const useAppStore = <T,>(selector?: (s: MockStoreState) => T) =>
    (selector ? selector(state) : (state as unknown as T));
  useAppStore.getState = () => state;
  useAppStore.setState = jest.fn();
  useAppStore.subscribe = jest.fn(() => () => {});
  return { useAppStore };
});

jest.mock('@/layers/MaskManager', () => ({
  getMaskManager: jest.fn(() => ({ applyMaskToCanvas: jest.fn() })),
}));

jest.mock('@/utils/perf/ccPerfProbe', () => ({
  CC_PERF: { on: false, verbose: false, counters: {} },
  recordColorCycleFillPerf: jest.fn(),
}));

jest.mock('@/workers/colorCycleFillClient', () => ({
  runConcentricFillJob: jest.fn(),
  runPerceptualDitherJob: jest.fn(),
}));

jest.mock('@/utils/pressureCurve', () => ({
  applyPressureCurve: jest.fn((value: number) => value),
}));

jest.mock('@/utils/colorCycle/ccDebug', () => ({
  ccDebugOn: jest.fn(() => false),
  ccLog: jest.fn(),
  ccWarn: jest.fn(),
}));

describe('ColorCycleBrushCanvas2D regression tests', () => {
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCaf = globalThis.cancelAnimationFrame;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    const mockedGetContext = function (this: HTMLCanvasElement) {
      return ensureMockContext(this) as unknown as CanvasRenderingContext2D;
    };
    HTMLCanvasElement.prototype.getContext = mockedGetContext as unknown as typeof HTMLCanvasElement.prototype.getContext;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
    globalThis.cancelAnimationFrame = () => {};
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCaf;
  });

  afterEach(() => {
    const state = useAppStore.getState() as unknown as MockStoreState;
    state.layers = [];
    state.tools.brushSettings = {};
  });

  it('updates indices on endStroke for sierra-lite stamp dither', () => {
    const canvas = makeCanvas(16, 16);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-1';

    brush.setStampDitherEnabled(true);
    brush.setStampDitherAlgorithm('sierra-lite');
    brush.setStampDitherPixelSize(2);

    brush.startStroke(layerId);
    brush.paint(4, 4, layerId, 1);
    brush.paint(6, 5, layerId, 1);
    brush.paint(8, 6, layerId, 1);

    const animator = (brush as unknown as { animators: Map<string, { getIndexBuffers: () => { data: Uint8Array } }> })
      .animators.get(layerId);
    if (!animator) {
      throw new Error('Missing animator for stamp dither test');
    }
    const before = animator.getIndexBuffers().data.slice();

    brush.endStroke(layerId);

    const after = animator.getIndexBuffers().data;
    expect(Array.from(after)).not.toEqual(Array.from(before));
    const snapshot = brush.getLayerSnapshot(layerId);
    expect(snapshot).not.toBeNull();
    expect(Array.from(new Uint8Array(snapshot!.paintBuffer))).toEqual(Array.from(after));
  });

  it('keeps the first tiny stroke on a fresh color-cycle layer', () => {
    const canvas = makeCanvas(64, 64);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-small-first-stroke';

    brush.setBrushSize(1);
    brush.startStroke(layerId);
    brush.paint(1, 1, layerId, 1);
    brush.endStroke(layerId);

    const snapshot = brush.getLayerSnapshot(layerId);
    expect(snapshot?.hasContent).toBe(true);
    expect(snapshot).not.toBeNull();
    expect(new Uint8Array(snapshot!.paintBuffer).some((value) => value !== 0)).toBe(true);
  });

  it('round-trips seam-profile def bindings through deserialize without store metadata', () => {
    const state = useAppStore.getState() as unknown as MockStoreState & {
      layers: Array<Record<string, unknown>>;
    };
    const layerId = 'layer-def-roundtrip';
    const defId = 11;
    const defHash = 'linear:#111111-soft';
    const slot = 5;

    state.layers = [
      {
        id: layerId,
        layerType: 'color-cycle',
        colorCycleData: {
          slotPalettes: [
            {
              slot,
              stops: [
                { position: 0, color: '#111111' },
                { position: 1, color: '#eeeeee' },
              ],
            },
          ],
          gradientDefStore: [
            {
              id: defId,
              kind: 'linear',
              slot,
              stops: [
                { position: 0, color: '#111111' },
                { position: 1, color: '#eeeeee' },
              ],
              hash: defHash,
              source: 'manual',
              seamProfile: 'soft',
              createdAtMs: 0,
            },
          ],
          nextGradientDefId: defId + 1,
          paintSlot: slot,
        },
      },
    ];

    const brush = new ColorCycleBrushCanvas2D(makeCanvas(4, 1), { forceCanvas2D: true });
    brush.applyLayerSnapshot(layerId, {
      paintBuffer: new Uint8Array([1, 2, 0, 0]).buffer,
      gradientIdBuffer: new Uint8Array([slot, slot, 0, 0]).buffer,
      gradientDefIdBuffer: new Uint16Array([defId, defId, 0, 0]).buffer,
      speedBuffer: new Uint8Array([32, 32, 0, 0]).buffer,
      flowBuffer: new Uint8Array([1, 1, 0, 0]).buffer,
      hasContent: true,
      strokeCounter: 3,
    });

    const serialized = brush.serialize();
    expect(serialized.layers[0]?.gradientDefStore?.[0]?.seamProfile).toBe('soft');

    state.layers = [];

    const restored = ColorCycleBrushCanvas2D.deserialize(serialized as never, makeCanvas(4, 1));
    const restoredSnapshot = restored.getLayerSnapshot(layerId);
    expect(Array.from(new Uint16Array(restoredSnapshot?.gradientDefIdBuffer ?? new ArrayBuffer(0)))).toEqual([
      defId,
      defId,
      0,
      0,
    ]);

    const restoredSerialized = restored.serialize();
    expect(restoredSerialized.layers[0]?.gradientDefStore?.[0]).toMatchObject({
      id: defId,
      slot,
      seamProfile: 'soft',
      hash: defHash,
    });

    restored.renderDirectToCanvas(makeCanvas(4, 1), layerId);

    const defCache = (restored as unknown as {
      defPaletteCacheByLayer: Map<string, { signaturesById: Map<number, string> }>;
      animators: Map<string, { defIdData?: Uint16Array | null }>;
    }).defPaletteCacheByLayer.get(layerId);
    expect(defCache?.signaturesById.get(defId)).toBe(
      appendGradientSeamProfileSignature(defHash, 'soft')
    );

    const animator = (restored as unknown as {
      animators: Map<string, { defIdData?: Uint16Array | null }>;
    }).animators.get(layerId);
    expect(Array.from(animator?.defIdData ?? [])).toEqual([defId, defId, 0, 0]);
  });

  it('preserves slot palette seam profiles during serialize when defs are absent', () => {
    const state = useAppStore.getState() as unknown as MockStoreState & {
      layers: Array<Record<string, unknown>>;
    };
    const layerId = 'layer-palette-seam-only';
    const slot = 2;

    state.layers = [
      {
        id: layerId,
        layerType: 'color-cycle',
        colorCycleData: {
          gradientDefs: [{ id: 'gradient-1', currentSlot: slot }],
          slotPalettes: [
            {
              slot,
              stops: [
                { position: 0, color: '#222222' },
                { position: 1, color: '#dddddd' },
              ],
              seamProfile: 'soft',
            },
          ],
          gradientDefStore: [],
          nextGradientDefId: 2,
          paintSlot: slot,
        },
      },
    ];

    const brush = new ColorCycleBrushCanvas2D(makeCanvas(4, 1), { forceCanvas2D: true });
    brush.applyLayerSnapshot(layerId, {
      paintBuffer: new Uint8Array([1, 1, 0, 0]).buffer,
      gradientIdBuffer: new Uint8Array([slot, slot, 0, 0]).buffer,
      gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
      speedBuffer: new Uint8Array([32, 32, 0, 0]).buffer,
      flowBuffer: new Uint8Array([1, 1, 0, 0]).buffer,
      hasContent: true,
      strokeCounter: 2,
    });

    const serialized = brush.serialize();
    expect(serialized.layers[0]?.slotPalettes?.[0]?.seamProfile).toBe('soft');
  });

  it('keeps finalized sampled shapes stable across a second sampled commit and serialize/deserialize after a tight ROI', () => {
    const layerId = 'layer-sampled-shape-stability';
    const canvas = makeCanvas(4, 1);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const state = useAppStore.getState() as unknown as MockStoreState;
    const sampledStopsA: StoredStop[] = [
      { position: 0, color: '#112233' },
      { position: 1, color: '#ddeeff' },
    ];
    const sampledStopsB: StoredStop[] = [
      { position: 0, color: '#aa5500' },
      { position: 1, color: '#ffeeaa' },
    ];
    const sessionA: MarkGradientSession = {
      markId: 'shape-a',
      layerId,
      markKind: 'shape',
      gradientKind: 'linear',
      source: 'sampled',
      frozenStopsStored: sampledStopsA,
      previewStopsStored: sampledStopsA,
      fallbackStopsStored: sampledStopsA,
      frozenHash: hashStops(sampledStopsA, 'linear'),
      binding: { kind: 'def', defId: 101, slot: 5 },
      speedCps: null,
    };
    const sessionB: MarkGradientSession = {
      markId: 'shape-b',
      layerId,
      markKind: 'shape',
      gradientKind: 'linear',
      source: 'sampled',
      frozenStopsStored: sampledStopsB,
      previewStopsStored: sampledStopsB,
      fallbackStopsStored: sampledStopsB,
      frozenHash: hashStops(sampledStopsB, 'linear'),
      binding: { kind: 'def', defId: 202, slot: 6 },
      speedCps: null,
    };

    state.layers = [
      {
        id: layerId,
        layerType: 'color-cycle',
        transparencyLocked: false,
        colorCycleData: {
          paintSlot: 0,
          slotPalettes: [],
          gradientDefStore: [],
        },
      },
    ];
    state.tools.brushSettings = {
      colorCycleUseForegroundGradient: false,
      ditherEnabled: true,
      gradientBands: 2,
      ditherPaletteSpread: 50,
    };
    state.updateLayer = jest.fn((targetLayerId: string, payload: { colorCycleData?: Record<string, unknown> }) => {
      state.layers = state.layers.map((layer) => {
        const typedLayer = layer as Record<string, unknown>;
        if (typedLayer.id !== targetLayerId) {
          return layer;
        }
        return {
          ...typedLayer,
          colorCycleData: {
            ...(typedLayer.colorCycleData as Record<string, unknown> | undefined),
            ...(payload.colorCycleData ?? {}),
          },
        };
      });
    });
    state.setCcGradientSampleCount = jest.fn();

    let finalizeStep = 0;
    const deps = {
      brushEngine: {
        fillCcGradientLinear: jest.fn(async () => {
          finalizeStep += 1;
          if (finalizeStep === 1) {
            brush.applyLayerSnapshot(layerId, {
              paintBuffer: new Uint8Array([1, 1, 1, 0]).buffer,
              gradientIdBuffer: new Uint8Array([TEMP_SAMPLE_SLOT, TEMP_SAMPLE_SLOT, TEMP_SAMPLE_SLOT, 0]).buffer,
              gradientDefIdBuffer: new Uint16Array([0, 0, 0, 0]).buffer,
              speedBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
              flowBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
              phaseBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
              hasContent: true,
              strokeCounter: 1,
            });
            return;
          }
          const current = brush.getLayerSnapshot(layerId);
          const paint = new Uint8Array(current?.paintBuffer ?? new ArrayBuffer(0));
          const gradientIds = new Uint8Array(current?.gradientIdBuffer ?? new ArrayBuffer(0));
          const gradientDefs = new Uint16Array(current?.gradientDefIdBuffer ?? new ArrayBuffer(0));
          paint[3] = 1;
          gradientIds[3] = TEMP_SAMPLE_SLOT;
          gradientDefs[3] = 0;
          brush.applyLayerSnapshot(layerId, {
            paintBuffer: paint.buffer.slice(0),
            gradientIdBuffer: gradientIds.buffer.slice(0),
            gradientDefIdBuffer: gradientDefs.buffer.slice(0),
            speedBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
            flowBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
            phaseBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
            hasContent: true,
            strokeCounter: 2,
          });
        }),
        updateColorCycleTexture: jest.fn(),
      } as never,
      getColorCycleBrushManager: () => ({ getBrush: () => brush as never }),
      bindBrushToCanvas: jest.fn(),
      timeAsync: async <T,>(_label: string, task: () => Promise<T>) => task(),
      timeSync: <T,>(_label: string, task: () => T) => task(),
      ccLog: jest.fn(),
      scheduleDeferredColorCycleSaveWithState: jest.fn(async () => undefined),
      logError: jest.fn(),
    };

    return finalizeColorCycleShapeFillLinear(
      {
        session: sessionA,
        shapePoints: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 0, y: 1 },
        ],
        direction: { x: 1, y: 0 },
        activeLayerId: layerId,
        activeLayerCanvas: canvas,
        overlayCanvas: null,
        overlayCtx: null,
        fallbackBlendMode: 'source-over',
        fallbackOpacity: 1,
        shapeLayerId: layerId,
        beforeColorState: null,
        tool: 'brush',
        roi: { x: 0, y: 0, width: 2, height: 1 },
      },
      deps
    ).then(async () => {
      const afterShapeA = brush.getLayerSnapshot(layerId);
      const shapeAGradientIds = Array.from(
        new Uint8Array(afterShapeA?.gradientIdBuffer ?? new ArrayBuffer(0))
      );
      const shapeADefIds = Array.from(
        new Uint16Array(afterShapeA?.gradientDefIdBuffer ?? new ArrayBuffer(0))
      );
      expect(shapeAGradientIds).toHaveLength(4);
      expect(shapeADefIds).toHaveLength(4);
      expect(shapeAGradientIds.slice(0, 3).every((value) => value === shapeAGradientIds[0])).toBe(true);
      expect(shapeAGradientIds.slice(0, 3)).not.toContain(TEMP_SAMPLE_SLOT);
      expect(shapeADefIds.slice(0, 3).every((value) => value === shapeADefIds[0] && value !== 0)).toBe(true);
      const persistedAfterShapeA = state.layers[0] as {
        colorCycleData?: { gradientIdBuffer?: ArrayBuffer; gradientDefIdBuffer?: ArrayBuffer };
      };
      expect(
        Array.from(new Uint8Array(persistedAfterShapeA.colorCycleData?.gradientIdBuffer ?? new ArrayBuffer(0)))
      ).toEqual(shapeAGradientIds);
      expect(
        Array.from(new Uint16Array(persistedAfterShapeA.colorCycleData?.gradientDefIdBuffer ?? new ArrayBuffer(0)))
      ).toEqual(shapeADefIds);

      await finalizeColorCycleShapeFillLinear(
        {
          session: sessionB,
          shapePoints: [
            { x: 3, y: 0 },
            { x: 3, y: 0 },
            { x: 3, y: 1 },
          ],
          direction: { x: 1, y: 0 },
          activeLayerId: layerId,
          activeLayerCanvas: canvas,
          overlayCanvas: null,
          overlayCtx: null,
          fallbackBlendMode: 'source-over',
          fallbackOpacity: 1,
          shapeLayerId: layerId,
          beforeColorState: null,
          tool: 'brush',
          roi: { x: 3, y: 0, width: 1, height: 1 },
        },
        deps
      );

      const afterShapeB = brush.getLayerSnapshot(layerId);
      const shapeBGradientIds = Array.from(
        new Uint8Array(afterShapeB?.gradientIdBuffer ?? new ArrayBuffer(0))
      );
      const shapeBDefIds = Array.from(
        new Uint16Array(afterShapeB?.gradientDefIdBuffer ?? new ArrayBuffer(0))
      );
      expect(shapeBGradientIds.slice(0, 3)).toEqual(shapeAGradientIds.slice(0, 3));
      expect(shapeBDefIds.slice(0, 3)).toEqual(shapeADefIds.slice(0, 3));
      expect(shapeBGradientIds).not.toContain(TEMP_SAMPLE_SLOT);
      expect(shapeBDefIds[3]).not.toBe(0);
      const persistedAfterShapeB = state.layers[0] as {
        colorCycleData?: { gradientIdBuffer?: ArrayBuffer; gradientDefIdBuffer?: ArrayBuffer };
      };
      expect(
        Array.from(new Uint8Array(persistedAfterShapeB.colorCycleData?.gradientIdBuffer ?? new ArrayBuffer(0)))
      ).toEqual(shapeBGradientIds);
      expect(
        Array.from(new Uint16Array(persistedAfterShapeB.colorCycleData?.gradientDefIdBuffer ?? new ArrayBuffer(0)))
      ).toEqual(shapeBDefIds);

      const restored = ColorCycleBrushCanvas2D.deserialize(brush.serialize(), makeCanvas(4, 1));
      const restoredSnapshot = restored.getLayerSnapshot(layerId);
      expect(Array.from(new Uint8Array(restoredSnapshot?.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual(
        shapeBGradientIds
      );
      expect(Array.from(new Uint16Array(restoredSnapshot?.gradientDefIdBuffer ?? new ArrayBuffer(0)))).toEqual(
        shapeBDefIds
      );
      expect(Array.from(new Uint8Array(restoredSnapshot?.gradientIdBuffer ?? new ArrayBuffer(0)))).not.toContain(
        TEMP_SAMPLE_SLOT
      );
    });
  });

  it('does not rebind already committed sampled pixels when a new sampled commit collides with their slot', () => {
    const layerId = 'layer-sampled-slot-collision';
    const slot = 7;
    const oldDefId = 101;
    const newDefId = 202;
    const brush = new ColorCycleBrushCanvas2D(makeCanvas(4, 1), { forceCanvas2D: true });
    const state = useAppStore.getState() as unknown as MockStoreState;

    state.layers = [
      {
        id: layerId,
        layerType: 'color-cycle',
        colorCycleData: {
          paintSlot: slot,
          slotPalettes: [
            {
              slot,
              stops: [
                { position: 0, color: '#111111' },
                { position: 1, color: '#eeeeee' },
              ],
            },
          ],
          gradientDefStore: [
            {
              id: oldDefId,
              kind: 'linear',
              stops: [
                { position: 0, color: '#111111' },
                { position: 1, color: '#eeeeee' },
              ],
              hash: 'linear:old',
              source: 'sampled',
              createdAtMs: 1,
              slot,
            },
            {
              id: newDefId,
              kind: 'linear',
              stops: [
                { position: 0, color: '#aa3300' },
                { position: 1, color: '#ffee99' },
              ],
              hash: 'linear:new',
              source: 'sampled',
              createdAtMs: 2,
              slot,
            },
          ],
        },
      },
    ];

    brush.applyLayerSnapshot(layerId, {
      paintBuffer: new Uint8Array([1, 1, 1, 1]).buffer,
      gradientIdBuffer: new Uint8Array([slot, slot, TEMP_SAMPLE_SLOT, slot]).buffer,
      gradientDefIdBuffer: new Uint16Array([oldDefId, oldDefId, 0, 0]).buffer,
      speedBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
      flowBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
      phaseBuffer: new Uint8Array([0, 0, 0, 0]).buffer,
      hasContent: true,
      strokeCounter: 1,
    });

    brush.commitCommittedLayerState({
      layerId,
      binding: {
        defId: newDefId,
        slot,
        previewSlot: TEMP_SAMPLE_SLOT,
      },
    });

    const after = brush.getLayerSnapshot(layerId);
    expect(Array.from(new Uint8Array(after?.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual([
      slot,
      slot,
      slot,
      slot,
    ]);
    expect(Array.from(new Uint16Array(after?.gradientDefIdBuffer ?? new ArrayBuffer(0)))).toEqual([
      oldDefId,
      oldDefId,
      newDefId,
      newDefId,
    ]);
  });

  it('authors active sampled strokes into the temp slot before commit rebinding', () => {
    const layerId = 'layer-sampled-stroke-temp-slot';
    const previousCommittedSlot = 12;
    const state = useAppStore.getState() as unknown as MockStoreState;
    state.layers = [
      {
        id: layerId,
        layerType: 'color-cycle',
        colorCycleData: {
          paintSlot: previousCommittedSlot,
          slotPalettes: [
            {
              slot: previousCommittedSlot,
              stops: [
                { position: 0, color: '#223344' },
                { position: 1, color: '#ddeeff' },
              ],
            },
          ],
          gradientDefStore: [],
        },
      },
    ];

    beginMarkGradientSession({
      layerId,
      markKind: 'stroke',
      gradientKind: 'linear',
      source: 'sampled',
      stops: [
        { position: 0, color: '#aa3300' },
        { position: 1, color: '#ffee99' },
      ],
      speedCps: 0.2,
    });

    const brush = new ColorCycleBrushCanvas2D(makeCanvas(16, 16), { forceCanvas2D: true });
    try {
      brush.setBrushSize(3);
      brush.setActiveGradientSlot(layerId, previousCommittedSlot);
      brush.startStroke(layerId);
      brush.paint(8, 8, layerId, 1);
      brush.endStroke(layerId);

      const snapshot = brush.getLayerSnapshot(layerId);
      const paint = new Uint8Array(snapshot?.paintBuffer ?? new ArrayBuffer(0));
      const gradientIds = new Uint8Array(snapshot?.gradientIdBuffer ?? new ArrayBuffer(0));
      const paintedSlots = new Set<number>();
      paint.forEach((value, index) => {
        if (value !== 0) {
          paintedSlots.add(gradientIds[index]);
        }
      });
      expect(paintedSlots).toEqual(new Set([TEMP_SAMPLE_SLOT]));
    } finally {
      finalizeMarkGradientSession(layerId);
    }
  });

  it('linear fill is monotonic along x (with at most one wrap)', async () => {
    const canvas = makeCanvas(24, 12);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-linear';
    brush.setGradientBands(16);
    brush.setBandSpacing(1);

    const vertices = [
      { x: 0, y: 0 },
      { x: canvas.width - 1, y: 0 },
      { x: canvas.width - 1, y: canvas.height - 1 },
      { x: 0, y: canvas.height - 1 },
    ];

    await brush.fillShapeDispatch({
      mode: 'linear',
      vertices,
      layerId,
      direction: { x: 1, y: 0 },
      options: { spacing: 1 },
    });

    const animator = (brush as unknown as { animators: Map<string, { getIndexBuffers: () => { data: Uint8Array } }> })
      .animators.get(layerId);
    if (!animator) {
      throw new Error('Missing animator for linear fill test');
    }
    const data = animator.getIndexBuffers().data;
    const y = Math.floor(canvas.height / 2);
    const values = [];
    for (let x = 0; x < canvas.width; x += 1) {
      const v = data[y * canvas.width + x];
      if (v > 0) {
        values.push(v);
      }
    }
    expect(values.length).toBeGreaterThan(0);
    let wraps = 0;
    for (let i = 1; i < values.length; i += 1) {
      if (values[i] < values[i - 1]) {
        wraps += 1;
      }
    }
    expect(wraps).toBeLessThanOrEqual(1);
  });

  it('concentric fill is symmetric across center', async () => {
    const canvas = makeCanvas(24, 24);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-concentric';
    brush.setGradientBands(16);
    brush.setBandSpacing(1);

    const vertices = [
      { x: 0, y: 0 },
      { x: canvas.width - 1, y: 0 },
      { x: canvas.width - 1, y: canvas.height - 1 },
      { x: 0, y: canvas.height - 1 },
    ];

    await brush.fillShapeDispatch({
      mode: 'concentric',
      vertices,
      layerId,
      options: { spacing: 1 },
    });

    const animator = (brush as unknown as { animators: Map<string, { getIndexBuffers: () => { data: Uint8Array } }> })
      .animators.get(layerId);
    if (!animator) {
      throw new Error('Missing animator for concentric fill test');
    }
    const data = animator.getIndexBuffers().data;
    const centerX = (canvas.width - 1) / 2;
    const centerY = Math.floor(canvas.height / 2);
    const dx = 3;
    const leftX = Math.max(0, Math.floor(centerX - dx));
    const rightX = Math.min(canvas.width - 1, Math.ceil(centerX + dx));
    const left = data[centerY * canvas.width + leftX];
    const right = data[centerY * canvas.width + rightX];
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  it('uses matching animation speed bytes for flat and banded sierra CC fills', async () => {
    const createBrush = (layerId: string) => {
      const canvas = makeCanvas(24, 12);
      const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
      brush.setSpeed(1);
      brush.setDitherEnabled(true);
      brush.setStampDitherAlgorithm('sierra-lite');
      brush.setGradientBands(16);
      brush.setBandSpacing(1);
      return { brush, layerId, canvas };
    };
    const vertices = [
      { x: 0, y: 0 },
      { x: 23, y: 0 },
      { x: 23, y: 11 },
      { x: 0, y: 11 },
    ];

    const flat = createBrush('layer-flat-speed');
    await flat.brush.fillShapeDispatch({
      mode: 'linear',
      vertices,
      layerId: flat.layerId,
      direction: { x: 1, y: 0 },
      options: {
        spacing: 1,
        ccGradient: true,
        ditherLevels: 1,
        ditherPairBandCount: 0,
      },
    });

    const banded = createBrush('layer-banded-speed');
    await banded.brush.fillShapeDispatch({
      mode: 'linear',
      vertices,
      layerId: banded.layerId,
      direction: { x: 1, y: 0 },
      options: {
        spacing: 1,
        ccGradient: true,
        ditherLevels: 4,
        ditherPairBandCount: 3,
      },
    });

    const flatAnimator = (flat.brush as unknown as {
      animators: Map<string, { getIndexBuffers: () => { spd: Uint8Array } }>;
    }).animators.get(flat.layerId);
    const bandedAnimator = (banded.brush as unknown as {
      animators: Map<string, { getIndexBuffers: () => { spd: Uint8Array } }>;
    }).animators.get(banded.layerId);

    if (!flatAnimator || !bandedAnimator) {
      throw new Error('Missing animator for CC fill speed regression test');
    }

    const flatSpeedByte = Array.from(flatAnimator.getIndexBuffers().spd).find((value) => value > 0);
    const bandedSpeedByte = Array.from(bandedAnimator.getIndexBuffers().spd).find((value) => value > 0);

    expect(flatSpeedByte).toBeDefined();
    expect(bandedSpeedByte).toBeDefined();

    const flatSpeed = decodeColorCycleSpeedByte(flatSpeedByte as number);
    const bandedSpeed = decodeColorCycleSpeedByte(bandedSpeedByte as number);

    expect(flatSpeed).toBeCloseTo(bandedSpeed, 5);
  });

  it('lost-edge only modifies pixels written by the fill', async () => {
    const canvas = makeCanvas(64, 64);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-lost-edge';

    brush.setDitherEnabled(false);
    brush.setDitherPixelSize(1);
    brush.setGradientBands(16);
    brush.setBandSpacing(1);

    brush.startStroke(layerId);
    for (let x = 6; x <= 58; x += 4) {
      brush.paint(x, 8, layerId, 1);
    }
    brush.endStroke(layerId);

    const animator = (brush as unknown as {
      animators: Map<string, { getIndexBuffers: () => { data: Uint8Array; gid?: Uint8Array; spd?: Uint8Array } }>;
    }).animators.get(layerId);
    if (!animator) {
      throw new Error('Missing animator for lost-edge test');
    }

    const pre = animator.getIndexBuffers();
    const preIdx = pre.data.slice();
    const preGid = pre.gid ? pre.gid.slice() : new Uint8Array(preIdx.length);
    const preSpd = pre.spd ? pre.spd.slice() : new Uint8Array(preIdx.length);

    const vertices = [
      { x: 16, y: 16 },
      { x: 48, y: 16 },
      { x: 48, y: 48 },
      { x: 16, y: 48 },
    ];

    await brush.fillShapeDispatch({
      mode: 'linear',
      vertices,
      layerId,
      direction: { x: 1, y: 0 },
      options: { spacing: 1, lostEdge: 0 },
    });

    const baseline = animator.getIndexBuffers().data.slice();

    brush.applyLayerSnapshot(
      layerId,
      {
        paintBuffer: preIdx.buffer.slice(0),
        gradientIdBuffer: preGid.buffer.slice(0),
        speedBuffer: preSpd.buffer.slice(0),
        hasContent: true,
        strokeCounter: 0,
      },
      {
        width: canvas.width,
        height: canvas.height,
        data: preIdx.buffer.slice(0),
        gradientIdData: preGid.buffer.slice(0),
        speedData: preSpd.buffer.slice(0),
      }
    );

    await brush.fillShapeDispatch({
      mode: 'linear',
      vertices,
      layerId,
      direction: { x: 1, y: 0 },
      options: { spacing: 1, lostEdge: 40 },
    });

    const withLost = animator.getIndexBuffers().data;
    const writtenMask = new Uint8Array(preIdx.length);
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const idx = y * canvas.width + x;
        if (baseline[idx] !== preIdx[idx]) {
          writtenMask[idx] = 1;
          continue;
        }
        if (pointInPolygon({ x: x + 0.5, y: y + 0.5 }, vertices)) {
          writtenMask[idx] = 1;
        }
      }
    }
    let violations = 0;
    for (let i = 0; i < preIdx.length; i += 1) {
      if (withLost[i] !== baseline[i] && writtenMask[i] === 0) {
        violations += 1;
        if (violations > 5) break;
      }
    }
    expect(violations).toBe(0);
  });

  it('keeps non-dither live preview speed static but enables playback speed on stroke end', () => {
    const canvas = makeCanvas(16, 16);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-speed-write-only';
    brush.setBrushSize(1);

    const firstSpeed = 0.2;
    const secondBaseSpeed = 1.6;
    const thirdBaseSpeed = 2.2;

    brush.setSpeed(firstSpeed);
    brush.startStroke(layerId);
    brush.paint(2, 2, layerId, 1);

    const animator = (brush as unknown as {
      animators: Map<string, {
        getIndexBuffers: () => { data: Uint8Array; spd?: Uint8Array };
        updateFrame: () => void;
      }>;
    }).animators.get(layerId);
    if (!animator) {
      throw new Error('Missing animator for speed write-only test');
    }

    const firstIndex = 2 + 2 * canvas.width;
    const secondIndex = 12 + 12 * canvas.width;
    const afterFirst = animator.getIndexBuffers().spd;
    if (!afterFirst) {
      throw new Error('Missing speed buffer for speed write-only test');
    }
    expect(afterFirst[firstIndex]).toBe(0);

    brush.endStroke(layerId);
    const afterFirstEnd = animator.getIndexBuffers().spd;
    if (!afterFirstEnd) {
      throw new Error('Missing speed buffer after first stroke end');
    }
    expect(afterFirstEnd[firstIndex]).toBeGreaterThan(0);

    const updateFrameSpy = jest.spyOn(animator, 'updateFrame');
    brush.updateAnimation();
    expect(updateFrameSpy).toHaveBeenCalled();
    updateFrameSpy.mockRestore();

    brush.setLayerBaseSpeed(secondBaseSpeed);

    const afterSecond = animator.getIndexBuffers().spd;
    if (!afterSecond) {
      throw new Error('Missing speed buffer after layer speed rescale');
    }
    expect(afterSecond[firstIndex]).toBeGreaterThan(0);

    brush.startStroke(layerId);
    brush.paint(12, 12, layerId, 1);

    const duringSecondStroke = animator.getIndexBuffers().spd;
    if (!duringSecondStroke) {
      throw new Error('Missing speed buffer during second stroke');
    }
    expect(duringSecondStroke[firstIndex]).toBeGreaterThan(0);
    expect(duringSecondStroke[secondIndex]).toBe(0);

    brush.endStroke(layerId);

    const afterNewStroke = animator.getIndexBuffers().spd;
    if (!afterNewStroke) {
      throw new Error('Missing speed buffer after second stroke');
    }
    expect(afterNewStroke[firstIndex]).toBeGreaterThan(0);
    expect(afterNewStroke[secondIndex]).toBeGreaterThan(0);

    const thirdIndex = 8 + 8 * canvas.width;

    brush.setLayerBaseSpeed(thirdBaseSpeed);
    const afterThirdBaseSpeed = animator.getIndexBuffers().spd;
    if (!afterThirdBaseSpeed) {
      throw new Error('Missing speed buffer after third base speed rescale');
    }
    expect(afterThirdBaseSpeed[firstIndex]).toBeGreaterThan(0);
    expect(afterThirdBaseSpeed[secondIndex]).toBeGreaterThan(0);

    brush.startStroke(layerId);
    brush.paint(8, 8, layerId, 1);

    const duringThirdStroke = animator.getIndexBuffers().spd;
    if (!duringThirdStroke) {
      throw new Error('Missing speed buffer during third stroke');
    }
    expect(duringThirdStroke[thirdIndex]).toBe(0);

    brush.endStroke(layerId);

    const afterThirdStroke = animator.getIndexBuffers().spd;
    if (!afterThirdStroke) {
      throw new Error('Missing speed buffer after third stroke');
    }
    expect(afterThirdStroke[firstIndex]).toBeGreaterThan(0);
    expect(afterThirdStroke[secondIndex]).toBeGreaterThan(0);
    expect(afterThirdStroke[thirdIndex]).toBeGreaterThan(0);
  });

  it('preserves prior non-dither stroke speed bytes when a new stroke uses a different speed', () => {
    const canvas = makeCanvas(16, 16);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-stroke-speed-preservation';
    brush.setBrushSize(1);

    const firstIndex = 2 + 2 * canvas.width;
    const secondIndex = 12 + 12 * canvas.width;

    brush.setSpeed(0.2);
    brush.startStroke(layerId);
    brush.paint(2, 2, layerId, 1);
    brush.endStroke(layerId);

    const animator = (brush as unknown as {
      animators: Map<string, { getIndexBuffers: () => { spd?: Uint8Array } }>;
    }).animators.get(layerId);
    if (!animator) {
      throw new Error('Missing animator for stroke speed preservation test');
    }

    const afterFirstStroke = animator.getIndexBuffers().spd;
    if (!afterFirstStroke) {
      throw new Error('Missing speed buffer after first stroke');
    }
    const firstStrokeByte = afterFirstStroke[firstIndex];
    expect(firstStrokeByte).toBeGreaterThan(0);
    expect(decodeColorCycleSpeedByte(firstStrokeByte)).toBeCloseTo(0.2, 2);

    brush.setSpeed(1.6);
    brush.startStroke(layerId);
    brush.paint(12, 12, layerId, 1);
    brush.endStroke(layerId);

    const afterSecondStroke = animator.getIndexBuffers().spd;
    if (!afterSecondStroke) {
      throw new Error('Missing speed buffer after second stroke');
    }

    expect(afterSecondStroke[firstIndex]).toBe(firstStrokeByte);
    expect(decodeColorCycleSpeedByte(afterSecondStroke[firstIndex])).toBeCloseTo(0.2, 2);
    expect(afterSecondStroke[secondIndex]).toBeGreaterThan(0);
    expect(decodeColorCycleSpeedByte(afterSecondStroke[secondIndex])).toBeCloseTo(1.6, 2);
  });

  it('preserves prior dithered stroke speed bytes when a new stroke uses a different speed', () => {
    const canvas = makeCanvas(16, 16);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-dither-stroke-speed-preservation';
    brush.setBrushSize(2);
    brush.setStampDitherEnabled(true);
    brush.setStampDitherAlgorithm('sierra-lite');
    brush.setStampDitherPixelSize(1);

    const firstIndex = 2 + 2 * canvas.width;
    const secondIndex = 12 + 12 * canvas.width;

    brush.setSpeed(0.2);
    brush.startStroke(layerId);
    brush.paint(2, 2, layerId, 1);
    brush.endStroke(layerId);

    const animator = (brush as unknown as {
      animators: Map<string, { getIndexBuffers: () => { spd?: Uint8Array } }>;
    }).animators.get(layerId);
    if (!animator) {
      throw new Error('Missing animator for dithered stroke speed preservation test');
    }

    const afterFirstStroke = animator.getIndexBuffers().spd;
    if (!afterFirstStroke) {
      throw new Error('Missing speed buffer after first dithered stroke');
    }
    const firstStrokeByte = afterFirstStroke[firstIndex];
    expect(firstStrokeByte).toBeGreaterThan(0);
    expect(decodeColorCycleSpeedByte(firstStrokeByte)).toBeCloseTo(0.2, 2);

    brush.setSpeed(1.6);
    brush.startStroke(layerId);
    brush.paint(12, 12, layerId, 1);
    brush.endStroke(layerId);

    const afterSecondStroke = animator.getIndexBuffers().spd;
    if (!afterSecondStroke) {
      throw new Error('Missing speed buffer after second dithered stroke');
    }

    expect(afterSecondStroke[firstIndex]).toBe(firstStrokeByte);
    expect(decodeColorCycleSpeedByte(afterSecondStroke[firstIndex])).toBeCloseTo(0.2, 2);
    expect(afterSecondStroke[secondIndex]).toBeGreaterThan(0);
    expect(decodeColorCycleSpeedByte(afterSecondStroke[secondIndex])).toBeCloseTo(1.6, 2);
  });

  it('preserves prior custom-stamp stroke speed bytes when a new stroke uses a different speed', () => {
    const canvas = makeCanvas(16, 16);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-custom-stamp-speed-preservation';
    brush.setBrushSize(1);
    const stamp = {
      imageData: new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1),
      width: 1,
      height: 1,
    };

    const firstIndex = 4 + 4 * canvas.width;
    const secondIndex = 12 + 12 * canvas.width;

    brush.setSpeed(0.2);
    brush.startStroke(layerId);
    brush.paintCustomStamp(stamp, 4, 4, layerId, 1);
    brush.endStroke(layerId);

    const animator = (brush as unknown as {
      animators: Map<string, { getIndexBuffers: () => { spd?: Uint8Array } }>;
    }).animators.get(layerId);
    if (!animator) {
      throw new Error('Missing animator for custom stamp speed preservation test');
    }

    const afterFirstStroke = animator.getIndexBuffers().spd;
    if (!afterFirstStroke) {
      throw new Error('Missing speed buffer after first custom stamp stroke');
    }
    const firstStrokeByte = afterFirstStroke[firstIndex];
    expect(firstStrokeByte).toBeGreaterThan(0);
    expect(decodeColorCycleSpeedByte(firstStrokeByte)).toBeCloseTo(0.2, 2);

    brush.setSpeed(1.6);
    brush.startStroke(layerId);
    brush.paintCustomStamp(stamp, 12, 12, layerId, 1);
    brush.endStroke(layerId);

    const afterSecondStroke = animator.getIndexBuffers().spd;
    if (!afterSecondStroke) {
      throw new Error('Missing speed buffer after second custom stamp stroke');
    }

    expect(afterSecondStroke[firstIndex]).toBe(firstStrokeByte);
    expect(decodeColorCycleSpeedByte(afterSecondStroke[firstIndex])).toBeCloseTo(0.2, 2);
    expect(afterSecondStroke[secondIndex]).toBeGreaterThan(0);
    expect(decodeColorCycleSpeedByte(afterSecondStroke[secondIndex])).toBeCloseTo(1.6, 2);
  });

  it('keeps CC gradient fill speed aligned with the slider across stop counts', async () => {
    const canvas = makeCanvas(16, 8);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const baseSpeed = 0.2;
    const rect = [
      { x: 0, y: 0 },
      { x: canvas.width - 1, y: 0 },
      { x: canvas.width - 1, y: canvas.height - 1 },
      { x: 0, y: canvas.height - 1 },
    ];

    brush.setSpeed(baseSpeed);

    const twoStopLayer = 'layer-cc-gradient-2';
    brush.setGradient([
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ], twoStopLayer);
    await brush.fillShapeDispatch({
      mode: 'linear',
      vertices: rect,
      layerId: twoStopLayer,
      direction: { x: 1, y: 0 },
      options: { ccGradient: true, continuous: true, spacing: 1, ditherLevels: 4, ditherPairBandCount: 3 },
    });

    const twoStopAnimator = (brush as unknown as {
      animators: Map<string, { getIndexBuffers: () => { spd?: Uint8Array } }>;
    }).animators.get(twoStopLayer);
    if (!twoStopAnimator) {
      throw new Error('Missing animator for two-stop CC gradient speed test');
    }
    const twoStopSpeed = twoStopAnimator.getIndexBuffers().spd?.find((value) => value > 0);
    if (!twoStopSpeed) {
      throw new Error('Missing speed byte for two-stop CC gradient speed test');
    }

    const fiveStopLayer = 'layer-cc-gradient-5';
    brush.setGradient([
      { position: 0, color: '#000000' },
      { position: 0.25, color: '#ff0000' },
      { position: 0.5, color: '#00ff00' },
      { position: 0.75, color: '#0000ff' },
      { position: 1, color: '#ffffff' },
    ], fiveStopLayer);
    await brush.fillShapeDispatch({
      mode: 'linear',
      vertices: rect,
      layerId: fiveStopLayer,
      direction: { x: 1, y: 0 },
      options: { ccGradient: true, continuous: true, spacing: 1, ditherLevels: 4, ditherPairBandCount: 3 },
    });

    const fiveStopAnimator = (brush as unknown as {
      animators: Map<string, { getIndexBuffers: () => { spd?: Uint8Array } }>;
    }).animators.get(fiveStopLayer);
    if (!fiveStopAnimator) {
      throw new Error('Missing animator for five-stop CC gradient speed test');
    }
    const fiveStopSpeed = fiveStopAnimator.getIndexBuffers().spd?.find((value) => value > 0);
    if (!fiveStopSpeed) {
      throw new Error('Missing speed byte for five-stop CC gradient speed test');
    }

    expect(decodeColorCycleSpeedByte(twoStopSpeed)).toBeCloseTo(baseSpeed, 2);
    expect(decodeColorCycleSpeedByte(fiveStopSpeed)).toBeCloseTo(baseSpeed, 2);
    expect(fiveStopSpeed).toBeCloseTo(twoStopSpeed, 0);
  });

  it('preserves prior CC shape speed bytes when a later shape uses a different speed', async () => {
    const canvas = makeCanvas(16, 8);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-shape-speed-preservation';
    const leftRect = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 7 },
      { x: 0, y: 7 },
    ];
    const rightRect = [
      { x: 10, y: 0 },
      { x: 15, y: 0 },
      { x: 15, y: 7 },
      { x: 10, y: 7 },
    ];

    brush.setSpeed(0.2);
    await brush.fillShapeDispatch({
      mode: 'concentric',
      vertices: leftRect,
      layerId,
      options: { ccGradient: true, spacing: 1 },
    });

    const animator = (brush as unknown as {
      animators: Map<string, { getIndexBuffers: () => { spd?: Uint8Array } }>;
    }).animators.get(layerId);
    if (!animator) {
      throw new Error('Missing animator for shape speed preservation test');
    }

    const firstIndex = 2 + 3 * canvas.width;
    const secondIndex = 12 + 3 * canvas.width;
    const afterFirstShape = animator.getIndexBuffers().spd;
    if (!afterFirstShape) {
      throw new Error('Missing speed buffer after first shape');
    }
    const firstShapeByte = afterFirstShape[firstIndex];
    expect(firstShapeByte).toBeGreaterThan(0);
    expect(decodeColorCycleSpeedByte(firstShapeByte)).toBeCloseTo(0.2, 2);

    brush.setSpeed(1.6);
    await brush.fillShapeDispatch({
      mode: 'concentric',
      vertices: rightRect,
      layerId,
      options: { ccGradient: true, spacing: 1 },
    });

    const afterSecondShape = animator.getIndexBuffers().spd;
    if (!afterSecondShape) {
      throw new Error('Missing speed buffer after second shape');
    }

    expect(afterSecondShape[firstIndex]).toBe(firstShapeByte);
    expect(decodeColorCycleSpeedByte(afterSecondShape[firstIndex])).toBeCloseTo(0.2, 2);
    expect(afterSecondShape[secondIndex]).toBeGreaterThan(0);
    expect(decodeColorCycleSpeedByte(afterSecondShape[secondIndex])).toBeCloseTo(1.6, 2);
  });

  it('preserves CC speed bytes across mixed shape and stroke authoring', async () => {
    const canvas = makeCanvas(16, 16);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-mixed-speed-preservation';
    brush.setBrushSize(1);

    const shapeRect = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ];
    const shapeIndex = 2 + 2 * canvas.width;
    const strokeIndex = 12 + 12 * canvas.width;

    brush.setSpeed(0.2);
    await brush.fillShapeDispatch({
      mode: 'concentric',
      vertices: shapeRect,
      layerId,
      options: { ccGradient: true, spacing: 1 },
    });

    const animator = (brush as unknown as {
      animators: Map<string, { getIndexBuffers: () => { spd?: Uint8Array } }>;
    }).animators.get(layerId);
    if (!animator) {
      throw new Error('Missing animator for mixed speed preservation test');
    }

    const afterShape = animator.getIndexBuffers().spd;
    if (!afterShape) {
      throw new Error('Missing speed buffer after shape');
    }
    const shapeSpeedByte = afterShape[shapeIndex];
    expect(shapeSpeedByte).toBeGreaterThan(0);
    expect(decodeColorCycleSpeedByte(shapeSpeedByte)).toBeCloseTo(0.2, 2);

    brush.setSpeed(1.6);
    brush.startStroke(layerId);
    brush.paint(12, 12, layerId, 1);
    brush.endStroke(layerId);

    const afterStroke = animator.getIndexBuffers().spd;
    if (!afterStroke) {
      throw new Error('Missing speed buffer after mixed stroke');
    }

    expect(afterStroke[shapeIndex]).toBe(shapeSpeedByte);
    expect(decodeColorCycleSpeedByte(afterStroke[shapeIndex])).toBeCloseTo(0.2, 2);
    expect(afterStroke[strokeIndex]).toBeGreaterThan(0);
    expect(decodeColorCycleSpeedByte(afterStroke[strokeIndex])).toBeCloseTo(1.6, 2);
  });

  it('authors non-dither stroke stamps with integer phase and palette indices', () => {
    const canvas = makeCanvas(16, 16);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-non-dither-baseline';
    brush.setBrushSize(1);
    brush.setStampShape('square');
    brush.setGradientBands(4);

    brush.startStroke(layerId);
    brush.paint(2, 2, layerId, 1);
    brush.paint(2, 2, layerId, 1);
    brush.paint(3, 2, layerId, 1);
    brush.paint(4, 2, layerId, 1);
    brush.endStroke(layerId);

    const animator = (brush as unknown as {
      animators: Map<string, { getIndexBuffers: () => { data: Uint8Array } }>;
    }).animators.get(layerId);
    const strokeState = (brush as unknown as {
      layerStrokes: Map<string, { strokePhaseUnits: number; stampCounter: number; lastPoint: { x: number; y: number } | null }>;
    }).layerStrokes.get(layerId);
    if (!animator || !strokeState) {
      throw new Error('Missing non-dither baseline state');
    }

    const data = animator.getIndexBuffers().data;
    expect(data[2 + 2 * canvas.width]).toBe(2);
    expect(data[3 + 2 * canvas.width]).toBe(3);
    expect(data[4 + 2 * canvas.width]).toBe(4);
    expect(strokeState.strokePhaseUnits).toBe(0);
    expect(strokeState.stampCounter).toBe(4);
    expect(strokeState.lastPoint).toBeNull();
  });

  it('uses one-step progression for non-dither stroke color', () => {
    const canvas = makeCanvas(16, 16);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-non-dither-progression';
    brush.setBrushSize(1);
    brush.setStampShape('square');

    brush.startStroke(layerId);
    brush.paint(2, 2, layerId, 1);
    brush.paint(10, 2, layerId, 1);
    brush.endStroke(layerId);

    const animator = (brush as unknown as {
      animators: Map<string, { getIndexBuffers: () => { data: Uint8Array } }>;
    }).animators.get(layerId);
    const strokeState = (brush as unknown as {
      layerStrokes: Map<string, { strokePhaseUnits: number }>;
    }).layerStrokes.get(layerId);
    if (!animator || !strokeState) {
      throw new Error('Missing non-dither progression state');
    }

    const data = animator.getIndexBuffers().data;
    expect(data[2 + 2 * canvas.width]).toBe(1);
    expect(data[10 + 2 * canvas.width]).toBe(2);
    expect(strokeState.strokePhaseUnits).toBe(0);
  });

  it('resets non-dither authored phase for each new stroke', () => {
    const canvas = makeCanvas(16, 16);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-non-dither-reset';
    brush.setBrushSize(1);
    brush.setStampShape('square');

    brush.startStroke(layerId);
    brush.paint(2, 2, layerId, 1);
    brush.paint(4, 2, layerId, 1);
    brush.endStroke(layerId);

    brush.startStroke(layerId);
    brush.paint(8, 2, layerId, 1);
    brush.endStroke(layerId);

    const animator = (brush as unknown as {
      animators: Map<string, { getIndexBuffers: () => { data: Uint8Array } }>;
    }).animators.get(layerId);
    const strokeState = (brush as unknown as {
      layerStrokes: Map<string, { strokePhaseUnits: number; stampCounter: number }>;
    }).layerStrokes.get(layerId);
    if (!animator || !strokeState) {
      throw new Error('Missing non-dither reset state');
    }

    const data = animator.getIndexBuffers().data;
    expect(data[8 + 2 * canvas.width]).toBe(1);
    expect(strokeState.strokePhaseUnits).toBe(0);
    expect(strokeState.stampCounter).toBe(1);
  });

  it('advances captured-data custom stamp phase even when stamp dithering is off', () => {
    const canvas = makeCanvas(16, 16);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-custom-non-dither-baseline';
    const stamp = {
      imageData: new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1),
      width: 1,
      height: 1,
      colorCycle: {
        schemaVersion: 2 as const,
        mode: 'captured-data' as const,
        sourceCycleLength: 256,
        mapWidth: 1,
        mapHeight: 1,
        phaseMap: new Uint16Array([1]),
      },
    };

    brush.setBrushSize(1);
    brush.startStroke(layerId);
    brush.paintCustomStamp(stamp, 4, 4, layerId, 1);
    brush.paintCustomStamp(stamp, 4, 4, layerId, 1);
    brush.paintCustomStamp(stamp, 5, 4, layerId, 1);
    brush.endStroke(layerId);

    const animator = (brush as unknown as {
      animators: Map<string, { getIndexBuffers: () => { data: Uint8Array } }>;
    }).animators.get(layerId);
    const strokeState = (brush as unknown as {
      layerStrokes: Map<string, { strokePhaseUnits: number; stampCounter: number }>;
    }).layerStrokes.get(layerId);
    if (!animator || !strokeState) {
      throw new Error('Missing custom stamp non-dither baseline state');
    }

    const data = animator.getIndexBuffers().data;
    expect(data[4 + 4 * canvas.width]).toBe(4);
    expect(data[5 + 4 * canvas.width]).toBe(5);
    expect(strokeState.strokePhaseUnits).toBe(3);
    expect(strokeState.stampCounter).toBe(3);
  });

  it('maps captured-data custom stamp pixels from their phase map when stamp dithering is off', () => {
    const canvas = makeCanvas(16, 16);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-custom-non-dither-single-index';
    const stamp = {
      imageData: new ImageData(new Uint8ClampedArray([
        255, 255, 255, 255,
        255, 255, 255, 255,
        255, 255, 255, 255,
      ]), 3, 1),
      width: 3,
      height: 1,
      colorCycle: {
        schemaVersion: 2 as const,
        mode: 'captured-data' as const,
        sourceCycleLength: 256,
        mapWidth: 3,
        mapHeight: 1,
        phaseMap: new Uint16Array([1, 128, 255]),
      },
    };

    brush.setBrushSize(3);
    brush.startStroke(layerId);
    brush.paintCustomStamp(stamp, 8, 8, layerId, 1);
    brush.endStroke(layerId);

    const animator = (brush as unknown as {
      animators: Map<string, { getIndexBuffers: () => { data: Uint8Array } }>;
    }).animators.get(layerId);
    if (!animator) {
      throw new Error('Missing custom stamp single-index animator');
    }

    const data = animator.getIndexBuffers().data;
    const y = 8 * canvas.width;
    const painted = [data[7 + y], data[8 + y], data[9 + y]].filter((value) => value > 0);
    expect(new Set(painted)).toEqual(new Set([2, 3, 130]));
  });

  it('treats captured-data phase maps as 0-based and does not skip phase 0 pixels', () => {
    const canvas = makeCanvas(16, 16);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-custom-captured-zero-based';
    const stamp = {
      imageData: new ImageData(new Uint8ClampedArray([
        255, 255, 255, 255,
        255, 255, 255, 255,
        255, 255, 255, 255,
      ]), 3, 1),
      width: 3,
      height: 1,
      colorCycle: {
        schemaVersion: 2 as const,
        mode: 'captured-data' as const,
        sourceCycleLength: 256,
        mapWidth: 3,
        mapHeight: 1,
        phaseMap: new Uint16Array([0, 1, 2]),
      },
    };

    brush.setBrushSize(3);
    brush.startStroke(layerId);
    brush.paintCustomStamp(stamp, 8, 8, layerId, 1);
    brush.endStroke(layerId);

    const animator = (brush as unknown as {
      animators: Map<string, { getIndexBuffers: () => { data: Uint8Array } }>;
    }).animators.get(layerId);
    if (!animator) {
      throw new Error('Missing custom stamp zero-based animator');
    }

    const data = animator.getIndexBuffers().data;
    const y = 8 * canvas.width;
    expect(data[7 + y]).toBeGreaterThan(0);
    expect(data[8 + y]).toBeGreaterThan(0);
    expect(data[9 + y]).toBeGreaterThan(0);
    expect(new Set([data[7 + y], data[8 + y], data[9 + y]])).toEqual(new Set([2, 3, 4]));
  });

  it('writes boosted speed bytes while keeping phase progression stamp-based', () => {
    const canvas = makeCanvas(16, 16);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-velocity-animation';
    brush.setBrushSize(1);
    brush.setGradientBands(254);
    brush.setSpeed(0.2);

    brush.startStroke(layerId);
    brush.paint(2, 2, layerId, 1);
    brush.paint(14, 2, layerId, 1, 0, 2.5);

    const animator = (brush as unknown as {
      animators: Map<string, { getIndexBuffers: () => { data: Uint8Array; spd?: Uint8Array } }>;
    }).animators.get(layerId);
    if (!animator) {
      throw new Error('Missing animator for velocity animation speed test');
    }
    const spd = animator.getIndexBuffers().spd;
    if (!spd) {
      throw new Error('Missing speed buffer for velocity animation speed test');
    }
    const firstIndex = 2 + 2 * canvas.width;
    const secondIndex = 14 + 2 * canvas.width;
    expect(spd[firstIndex]).toBe(0);
    expect(spd[secondIndex]).toBe(0);

    brush.endStroke(layerId);
    const afterEndSpd = animator.getIndexBuffers().spd;
    if (!afterEndSpd) {
      throw new Error('Missing speed buffer after velocity stroke end');
    }
    expect(afterEndSpd[firstIndex]).toBeGreaterThan(0);
    expect(afterEndSpd[secondIndex]).toBeGreaterThan(0);

    const strokeState = (brush as unknown as {
      layerStrokes: Map<string, { strokePhaseUnits: number }>;
    }).layerStrokes.get(layerId);
    if (!strokeState) {
      throw new Error('Missing stroke state for velocity animation speed test');
    }
    expect(strokeState.strokePhaseUnits).toBe(0);

  });

  it('keeps phase advance fixed regardless of flow velocity input', () => {
    const canvas = makeCanvas(16, 16);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });

    const lowSpeedAdvance = (brush as unknown as {
      resolvePhaseAdvancePerStamp: (speedSamplePxPerMs?: number) => number;
    }).resolvePhaseAdvancePerStamp(0.1);
    const highSpeedAdvance = (brush as unknown as {
      resolvePhaseAdvancePerStamp: (speedSamplePxPerMs?: number) => number;
    }).resolvePhaseAdvancePerStamp(2.5);

    expect(lowSpeedAdvance).toBe(1);
    expect(highSpeedAdvance).toBe(1);
  });

  it('keeps custom captured-data stamp phase progression independent from flow velocity', () => {
    const layerId = 'layer-custom-captured-velocity';
    const makeBrush = () => {
      const canvas = makeCanvas(16, 16);
      const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
      brush.setBrushSize(1);
      brush.startStroke(layerId);
      return { brush, canvas };
    };

    const stamp = {
      imageData: new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1),
      width: 1,
      height: 1,
      colorCycle: {
        schemaVersion: 2 as const,
        mode: 'captured-data' as const,
        sourceCycleLength: 256,
        mapWidth: 1,
        mapHeight: 1,
        phaseMap: new Uint16Array([1]),
      },
    };

    const low = makeBrush();
    low.brush.paintCustomStamp(stamp, 4, 4, layerId, 1, 0, 0.1);
    low.brush.endStroke(layerId);
    const lowStroke = (low.brush as unknown as {
      layerStrokes: Map<string, { strokePhaseUnits: number }>;
    }).layerStrokes.get(layerId);
    if (!lowStroke) {
      throw new Error('Missing low-speed stroke data');
    }

    const high = makeBrush();
    high.brush.paintCustomStamp(stamp, 4, 4, layerId, 1, 0, 2.5);
    high.brush.endStroke(layerId);
    const highStroke = (high.brush as unknown as {
      layerStrokes: Map<string, { strokePhaseUnits: number }>;
    }).layerStrokes.get(layerId);
    if (!highStroke) {
      throw new Error('Missing high-speed stroke data');
    }

    expect(lowStroke.strokePhaseUnits).toBe(highStroke.strokePhaseUnits);
  });

  it('keeps 1px color-cycle square strokes to a single pixel per stamp', () => {
    const canvas = makeCanvas(16, 16);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-1px-square';

    brush.setBrushSize(1);
    brush.setStampShape('square');
    brush.startStroke(layerId);
    brush.paint(6, 6, layerId, 1);
    brush.endStroke(layerId);

    const animator = (brush as unknown as { animators: Map<string, { getIndexBuffers: () => { data: Uint8Array } }> })
      .animators.get(layerId);
    if (!animator) {
      throw new Error('Missing animator for 1px square test');
    }

    const data = animator.getIndexBuffers().data;
    let written = 0;
    for (const value of data) {
      if (value !== 0) {
        written += 1;
      }
    }

    expect(written).toBe(1);
    expect(data[6 + 6 * canvas.width]).toBeGreaterThan(0);
  });

  it('does not republish an unchanged def palette cache to the animator', () => {
    const canvas = makeCanvas(4, 4);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-def-cache-reuse';
    const strokeData = {
      buffers: {
        def: new Uint16Array(16),
      },
    };
    const animator = {
      setDefIdData: jest.fn(),
      setDefPaletteCache: jest.fn(),
    };
    const defs = [
      {
        id: 7,
        hash: 'linear:0:#000000|1:#ffffff',
        stops: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        seamProfile: 'hard' as const,
      },
    ];
    type DefEntry = {
      id: number;
      hash: string;
      stops: Array<{ position: number; color: string }>;
      seamProfile: 'hard';
    };

    (brush as unknown as {
      applyDefBindingsForLayer: (
        layerId: string,
        animator: {
          setDefIdData: (data?: Uint16Array | null, options?: { forceDirty?: boolean }) => void;
          setDefPaletteCache: (cache: unknown) => void;
        },
        strokeData: { buffers: { def: Uint16Array } },
        defs: DefEntry[],
        options?: { forceDefDirty?: boolean },
      ) => void;
    }).applyDefBindingsForLayer(layerId, animator, strokeData, defs);
    (brush as unknown as {
      applyDefBindingsForLayer: (
        layerId: string,
        animator: {
          setDefIdData: (data?: Uint16Array | null, options?: { forceDirty?: boolean }) => void;
          setDefPaletteCache: (cache: unknown) => void;
        },
        strokeData: { buffers: { def: Uint16Array } },
        defs: DefEntry[],
        options?: { forceDefDirty?: boolean },
      ) => void;
    }).applyDefBindingsForLayer(layerId, animator, strokeData, defs);

    expect(animator.setDefIdData).toHaveBeenCalledTimes(2);
    expect(animator.setDefIdData).toHaveBeenNthCalledWith(1, strokeData.buffers.def, undefined);
    expect(animator.setDefIdData).toHaveBeenNthCalledWith(2, strokeData.buffers.def, undefined);
    expect(animator.setDefPaletteCache).toHaveBeenCalledTimes(1);
  });

  it('forces def dirty only when requested for in-place def buffer mutations', () => {
    const canvas = makeCanvas(4, 4);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-def-force-dirty';
    const strokeData = {
      buffers: {
        def: new Uint16Array(16),
      },
    };
    const animator = {
      setDefIdData: jest.fn(),
      setDefPaletteCache: jest.fn(),
    };
    const defs = [
      {
        id: 8,
        hash: 'linear:0:#111111|1:#eeeeee',
        stops: [
          { position: 0, color: '#111111' },
          { position: 1, color: '#eeeeee' },
        ],
        seamProfile: 'hard' as const,
      },
    ];
    type DefEntry = {
      id: number;
      hash: string;
      stops: Array<{ position: number; color: string }>;
      seamProfile: 'hard';
    };

    (brush as unknown as {
      applyDefBindingsForLayer: (
        layerId: string,
        animator: {
          setDefIdData: (data?: Uint16Array | null, options?: { forceDirty?: boolean }) => void;
          setDefPaletteCache: (cache: unknown) => void;
        },
        strokeData: { buffers: { def: Uint16Array } },
        defs: DefEntry[],
        options?: { forceDefDirty?: boolean },
      ) => void;
    }).applyDefBindingsForLayer(layerId, animator, strokeData, defs, { forceDefDirty: true });

    expect(animator.setDefIdData).toHaveBeenCalledWith(strokeData.buffers.def, { forceDirty: true });
  });

  it('stops the animation loop after the last color-cycle layer is cleared', () => {
    const previousRaf = globalThis.requestAnimationFrame;
    const previousCaf = globalThis.cancelAnimationFrame;
    let nextFrameId = 1;
    const scheduledFrames = new Map<number, FrameRequestCallback>();

    globalThis.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
      const id = nextFrameId++;
      scheduledFrames.set(id, cb);
      return id;
    });
    globalThis.cancelAnimationFrame = jest.fn((id: number) => {
      scheduledFrames.delete(id);
    });

    try {
      const canvas = makeCanvas(16, 16);
      const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
      const layerId = 'layer-stop-loop-after-clear';
      const internals = brush as unknown as {
        ensureStrokeState: (id: string) => {
          hasContent: boolean;
          buffers: {
            paint: Uint8Array;
            gid: Uint8Array;
            spd: Uint8Array;
            flow: Uint8Array;
            phase: Uint8Array;
            def: Uint16Array;
          };
        };
      };
      const strokeData = internals.ensureStrokeState(layerId);
      strokeData.hasContent = true;
      strokeData.buffers.paint[0] = 1;

      for (const [pendingFrameId, pendingFrame] of Array.from(scheduledFrames.entries())) {
        scheduledFrames.delete(pendingFrameId);
        pendingFrame(0);
      }

      brush.startAnimation();
      expect(brush.isPlaying()).toBe(true);
      expect(scheduledFrames.size).toBe(1);

      brush.clearPaintBuffer(layerId);

      expect(brush.isPlaying()).toBe(false);
      for (const [pendingFrameId, pendingFrame] of Array.from(scheduledFrames.entries())) {
        scheduledFrames.delete(pendingFrameId);
        pendingFrame(32);
      }
      expect(scheduledFrames.size).toBe(0);
    } finally {
      globalThis.requestAnimationFrame = previousRaf;
      globalThis.cancelAnimationFrame = previousCaf;
    }
  });
});
