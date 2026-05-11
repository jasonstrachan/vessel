/* eslint-disable @typescript-eslint/no-explicit-any */
import { ColorCycleBrushCanvas2D } from '../ColorCycleBrushCanvas2D';
import * as stampDither from '../strokeStampDither';
import { encodeRgbaToBase64 } from '@/utils/colorCycle/ccCustomTilePattern';
const animatorMocks = jest.requireMock('@/lib/ColorCycleAnimator').__mocks__ as {
  setIndexBufferFromArrayMock: jest.Mock;
  deserializeSpy: jest.Mock;
  beginDirectFillMock: jest.Mock;
  endDirectFillMock: jest.Mock;
  markDirtyBoundsMock: jest.Mock;
  endStrokeMock: jest.Mock;
  forceRenderMock: jest.Mock;
  resizeMock: jest.Mock;
};

jest.mock('@/lib/ColorCycleAnimator', () => {
  const setIndexBufferFromArrayMock = jest.fn();

  const deserializeSpy = jest.fn();
  const beginDirectFillMock = jest.fn();
  const endDirectFillMock = jest.fn();
  const markDirtyBoundsMock = jest.fn();
  const endStrokeMock = jest.fn();
  const forceRenderMock = jest.fn();
  const resizeMock = jest.fn();

  class MockAnimator {
    width: number;
    height: number;
    fps: number;
    indexBuffer?: Uint8Array;
    gradientId?: Uint8Array;
    speedData?: Uint8Array;
    flowData?: Uint8Array;
    phaseData?: Uint8Array;

    constructor(opts: { width: number; height: number; fps?: number }) {
      this.width = opts.width;
      this.height = opts.height;
      this.fps = opts.fps ?? 0;
    }

    serialize() {
      return {
        indexBuffer: {
          width: this.width,
          height: this.height,
          data: new Uint8Array(this.width * this.height),
          speedData: new Uint8Array(this.width * this.height),
          flowData: new Uint8Array(this.width * this.height),
          palette: [] as string[],
        },
        gradient: {
          gradientStops: [],
          paletteSize: 256,
        },
        animation: {
          offset: 0,
          stats: {
            targetFPS: this.fps,
            actualFPS: 0,
            frameCount: 0,
            totalTime: 0,
            averageFrameTime: 0,
            isAnimating: false,
          },
        },
      };
    }

    static deserialize(data: any) {
      const inst = new MockAnimator({
        width: data.indexBuffer?.width ?? 1,
        height: data.indexBuffer?.height ?? 1,
        fps: data.animation?.stats?.targetFPS ?? 0,
      });
      deserializeSpy(data);
      return inst;
    }

    resize(w: number, h: number) {
      resizeMock(w, h);
      this.width = w;
      this.height = h;
    }

    setIndexBufferFromArray(
      arr: Uint8Array,
      gradientId?: Uint8Array,
      speedData?: Uint8Array,
      flowData?: Uint8Array
    ) {
      this.indexBuffer = arr;
      if (gradientId) {
        this.gradientId = gradientId;
      }
      if (speedData) {
        this.speedData = speedData;
      }
      if (flowData) {
        this.flowData = flowData;
      }
      setIndexBufferFromArrayMock(arr, gradientId, speedData, flowData);
    }

    getDimensions() {
      return { width: this.width, height: this.height };
    }

    getIndexBuffers() {
      if (!this.indexBuffer) {
        this.indexBuffer = new Uint8Array(this.width * this.height);
      }
      if (!this.gradientId) {
        this.gradientId = new Uint8Array(this.width * this.height);
      }
      if (!this.speedData) {
        this.speedData = new Uint8Array(this.width * this.height);
      }
      if (!this.flowData) {
        this.flowData = new Uint8Array(this.width * this.height);
      }
      if (!this.phaseData) {
        this.phaseData = new Uint8Array(this.width * this.height);
      }
      return {
        data: this.indexBuffer,
        gid: this.gradientId,
        spd: this.speedData,
        flow: this.flowData,
        phase: this.phaseData,
      };
    }

    renderToCanvas2D(ctx: CanvasRenderingContext2D) {
      void ctx;
    }

    setFlowMode() {}
    setSpeed() {}

    getCanvas() {
      const canvas = document.createElement('canvas');
      canvas.width = this.width;
      canvas.height = this.height;
      canvas.getContext = jest.fn(() => ({
        getImageData: jest.fn(() => ({
          data: new Uint8ClampedArray(this.width * this.height * 4),
          width: this.width,
          height: this.height,
        })),
        clearRect: jest.fn(),
      })) as any;
      return canvas;
    }

    beginDirectFill() {
      beginDirectFillMock();
      if (!this.indexBuffer) {
        this.indexBuffer = new Uint8Array(this.width * this.height);
      }
      if (!this.gradientId) {
        this.gradientId = new Uint8Array(this.width * this.height);
      }
      if (!this.speedData) {
        this.speedData = new Uint8Array(this.width * this.height);
      }
      if (!this.flowData) {
        this.flowData = new Uint8Array(this.width * this.height);
      }
      if (!this.phaseData) {
        this.phaseData = new Uint8Array(this.width * this.height);
      }
      return {
        data: this.indexBuffer,
        gradientId: this.gradientId,
        speedData: this.speedData,
        flowData: this.flowData,
        phaseData: this.phaseData,
        width: this.width,
        height: this.height,
      };
    }

    endDirectFill() {
      endDirectFillMock();
    }

    markDirtyBounds() {
      markDirtyBoundsMock();
    }

    endStroke() {
      endStrokeMock();
    }

    forceRender() {
      forceRenderMock();
    }

    hasWebGL() {
      return false;
    }
  }

  return {
    ColorCycleAnimator: MockAnimator,
    __mocks__: {
      setIndexBufferFromArrayMock,
      deserializeSpy,
      beginDirectFillMock,
      endDirectFillMock,
      markDirtyBoundsMock,
      endStrokeMock,
      forceRenderMock,
      resizeMock,
    },
  };
});

jest.mock('@/stores/useAppStore', () => {
  const state = { layers: [] } as any;
  const useAppStore = (selector?: (s: any) => unknown) => (selector ? selector(state) : state);
  useAppStore.getState = () => state;
  useAppStore.setState = jest.fn();
  useAppStore.subscribe = jest.fn(() => () => {});
  return { useAppStore };
});

jest.mock('@/utils/colorCycle/ccDebug', () => ({
  ccDebugOn: jest.fn(() => false),
  ccLog: jest.fn(),
  ccWarn: jest.fn(),
}));

jest.mock('@/layers/MaskManager', () => ({
  getMaskManager: jest.fn(() => ({ applyMask: jest.fn() })),
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

jest.mock('@/utils/colorCycle/concentricFillCore', () => ({
  fillConcentricIndices: jest.fn(),
  computeConcentricMaxDistance: jest.fn(() => 1),
}));

jest.mock('@/utils/colorCycle/fillMath', () => ({
  applyEdgePadding: jest.fn(),
}));

jest.mock('@/utils/polygonSimplify', () => ({
  simplifyToVertexLimit: jest.fn((pts: any) => pts),
}));

jest.mock('@/utils/canvasPool', () => ({
  canvasPool: {
    acquire: jest.fn(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 4;
      canvas.getContext = jest.fn(() => ({
        clearRect: jest.fn(),
        drawImage: jest.fn(),
        getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
        putImageData: jest.fn(),
      })) as any;
      return canvas as HTMLCanvasElement;
    }),
    release: jest.fn(),
  },
}));

jest.mock('../ccGradientFillDither', () => ({
  fillLinear: jest.fn((imageData: ImageData) => imageData),
  fillConcentric: jest.fn((imageData: ImageData) => imageData),
}));

jest.mock('@/utils/colorCycle/ccGradientDither', () => ({
  fillCcGradientDither: jest.fn(async () => {}),
}));

const fillDitherMocks = jest.requireMock('../ccGradientFillDither') as {
  fillLinear: jest.Mock;
  fillConcentric: jest.Mock;
};

const ccGradientDitherMocks = jest.requireMock('@/utils/colorCycle/ccGradientDither') as {
  fillCcGradientDither: jest.Mock;
};
const pressureCurveMocks = jest.requireMock('@/utils/pressureCurve') as {
  applyPressureCurve: jest.Mock;
};
const concentricFillMocks = jest.requireMock('@/utils/colorCycle/concentricFillCore') as {
  fillConcentricIndices: jest.Mock;
  computeConcentricMaxDistance: jest.Mock;
};

const makeCanvas = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 6;
  canvas.getContext = jest.fn(() => ({
    clearRect: jest.fn(),
    drawImage: jest.fn(),
    putImageData: jest.fn(),
    getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(8 * 6 * 4), width: 8, height: 6 })),
    save: jest.fn(),
    restore: jest.fn(),
  })) as any;
  return canvas as HTMLCanvasElement;
};

describe('ColorCycleBrushCanvas2D', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
    consoleLogSpy.mockRestore();
  });

  it('round-trips stroke snapshot and settings via serialize/deserialize', () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas, { brushSize: 10, fps: 60 });

    const paint = new Uint8Array(canvas.width * canvas.height);
    paint[0] = 5;
    paint[5] = 9;

    brush.applyLayerSnapshot('layer-1', {
      paintBuffer: paint.buffer,
      hasContent: true,
      strokeCounter: 7,
    });

    brush.setStampShape('checkered');
    brush.setDitherEnabled(true);
    brush.setDitherStrength(0.5);
    brush.setDitherPixelSize(4);
    brush.setPerceptualDither(true);
    brush.setStampDitherEnabled(true);
    brush.setStampDitherPixelSize(3);
    brush.setStampDitherAlgorithm('pattern');
    brush.setStampDitherPatternStyle('crosshatch');
    brush.setStampDitherPatternTileSettings({
      patternTileId: 'tile-a',
      patternTileScale: 2,
      patternTileInvert: true,
      patternTileThreshold: 0.4,
      patternTileOffsetX: 3,
      patternTileOffsetY: 4,
    });
    brush.setStampDitherBgFill(false);
    brush.setStampDitherPressureLinked(true);

    const serialized = brush.serialize();

    expect(serialized.layers).toHaveLength(1);
    const strokeData = serialized.layers[0].strokeData;
    expect(strokeData?.strokeCounter).toBe(7);
    expect(strokeData?.paintBuffer.byteLength).toBe(paint.byteLength);
    expect(serialized.ditherEnabled).toBe(true);
    expect(serialized.ditherStrength).toBe(0.5);
    expect(serialized.ditherPixelSize).toBe(4);
    expect(serialized.perceptualDither).toBe(true);
    expect(serialized.stampShape).toBe('checkered');
    expect(serialized.stampDitherPixelSize).toBe(3);
    expect(serialized.stampDitherAlgorithm).toBe('pattern');
    expect(serialized.stampDitherPatternStyle).toBe('crosshatch');
    expect(serialized.stampDitherPatternTileId).toBe('tile-a');
    expect(serialized.stampDitherPatternTileScale).toBe(2);
    expect(serialized.stampDitherPatternTileInvert).toBe(true);
    expect(serialized.stampDitherPatternTileThreshold).toBe(0.4);
    expect(serialized.stampDitherPatternTileOffsetX).toBe(3);
    expect(serialized.stampDitherPatternTileOffsetY).toBe(4);
    expect(serialized.stampDitherBgFill).toBe(false);
    expect(serialized.stampDitherClears).toBe(true);
    expect(serialized.stampDitherPressureLinked).toBe(true);

    const roundTripped = ColorCycleBrushCanvas2D.deserialize(serialized, makeCanvas());
    const snapshot = roundTripped.getLayerSnapshot('layer-1');
    expect(snapshot?.strokeCounter).toBe(7);
    expect(new Uint8Array(snapshot!.paintBuffer)[0]).toBe(5);
    expect(roundTripped.serialize().ditherEnabled).toBe(true);
    expect(roundTripped.serialize().ditherStrength).toBe(0.5);
    expect(roundTripped.serialize().ditherPixelSize).toBe(4);
    expect(roundTripped.serialize().perceptualDither).toBe(true);
    expect(roundTripped.serialize().stampDitherAlgorithm).toBe('pattern');
    expect(roundTripped.serialize().stampDitherPatternStyle).toBe('crosshatch');
    expect(roundTripped.serialize().stampDitherPatternTileId).toBe('tile-a');
    expect(roundTripped.serialize().stampDitherPatternTileScale).toBe(2);
    expect(roundTripped.serialize().stampDitherPatternTileInvert).toBe(true);
    expect(roundTripped.serialize().stampDitherPatternTileThreshold).toBe(0.4);
    expect(roundTripped.serialize().stampDitherPatternTileOffsetX).toBe(3);
    expect(roundTripped.serialize().stampDitherPatternTileOffsetY).toBe(4);
    expect(roundTripped.serialize().stampDitherPressureLinked).toBe(true);
  });

  it('reuses the image-tile resolver while tile settings and project tile data are unchanged', () => {
    const { useAppStore } = jest.requireMock('@/stores/useAppStore') as {
      useAppStore: { getState: () => any };
    };
    useAppStore.getState().project = {
      ccCustomTilePatterns: [
        {
          id: 'tile-a',
          name: 'Tile A',
          width: 1,
          height: 1,
          rgbaBase64: encodeRgbaToBase64(Uint8Array.from([0, 0, 0, 255])),
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };

    const brush = new ColorCycleBrushCanvas2D(makeCanvas(), { brushSize: 10, fps: 60 });
    brush.setStampDitherPatternTileSettings({
      patternTileId: 'tile-a',
      patternTileScale: 1,
      patternTileInvert: false,
      patternTileThreshold: null,
      patternTileOffsetX: 0,
      patternTileOffsetY: 0,
    });

    const firstResolver = (brush as any).getStampDitherImageTileThresholdResolver();
    const secondResolver = (brush as any).getStampDitherImageTileThresholdResolver();

    expect(firstResolver).toBeDefined();
    expect(secondResolver).toBe(firstResolver);

    useAppStore.getState().project.ccCustomTilePatterns = [
      {
        id: 'tile-a',
        name: 'Tile A',
        width: 1,
        height: 1,
        rgbaBase64: encodeRgbaToBase64(Uint8Array.from([255, 255, 255, 255])),
        createdAt: 1,
        updatedAt: 2,
      },
    ];

    expect((brush as any).getStampDitherImageTileThresholdResolver()).not.toBe(firstResolver);
  });

  it('does not duplicate animator index buffers when stroke snapshots already own restore data', () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas, { brushSize: 10, fps: 60 });

    const paint = new Uint8Array(canvas.width * canvas.height);
    const gradientId = new Uint8Array(canvas.width * canvas.height);
    const speed = new Uint8Array(canvas.width * canvas.height);
    paint[0] = 5;
    gradientId[0] = 7;
    speed[0] = 9;

    brush.applyLayerSnapshot('layer-dup-prune', {
      paintBuffer: paint.buffer,
      gradientIdBuffer: gradientId.buffer,
      speedBuffer: speed.buffer,
      hasContent: true,
      strokeCounter: 4,
    });

    const serialized = brush.serialize();
    const layer = serialized.layers[0];

    expect(layer?.strokeData?.paintBuffer.byteLength).toBe(paint.byteLength);
    expect(layer?.data.indexBuffer.data.byteLength).toBe(0);
    expect(layer?.data.indexBuffer.gradientId?.byteLength ?? 0).toBe(0);
    expect(layer?.data.indexBuffer.speedData?.byteLength ?? 0).toBe(0);
    expect(layer?.data.indexBuffer.flowData?.byteLength ?? 0).toBe(0);
    expect(layer?.data.indexBuffer.phaseData?.byteLength ?? 0).toBe(0);
  });

  it('restores layer base speed through restoreFullState', () => {
    const source = new ColorCycleBrushCanvas2D(makeCanvas(), { brushSize: 10, fps: 60 });
    source.setLayerBaseSpeed(1.75);

    const restored = new ColorCycleBrushCanvas2D(makeCanvas(), { brushSize: 10, fps: 60 });
    restored.restoreFullState(source.serialize() as any);

    expect(restored.serialize().layerBaseSpeed).toBeCloseTo(1.75, 5);
  });

  it('applies layer snapshot with size mismatch and updates animator buffer', () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas);

    const smallBuffer = new Uint8Array([1, 2]).buffer; // smaller than expected 48 bytes

    brush.applyLayerSnapshot('layer-small', {
      paintBuffer: smallBuffer,
      hasContent: true,
      strokeCounter: 2,
    });

    // Animator should receive a buffer matching canvas area
    expect(animatorMocks.setIndexBufferFromArrayMock).toHaveBeenCalled();
    const applied = animatorMocks.setIndexBufferFromArrayMock.mock.calls.slice(-1)[0][0] as Uint8Array;
    expect(applied.length).toBe(canvas.width * canvas.height);

    const snapshot = brush.getLayerSnapshot('layer-small');
    expect(snapshot?.paintBuffer.byteLength).toBe(canvas.width * canvas.height);
    expect(snapshot?.strokeCounter).toBe(2);
  });

  it('finalizes error diffusion stamp dithering on endStroke for finalize-only algos', () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas, { brushSize: 4, fps: 60 });
    const finalizeSpy = jest.spyOn(stampDither, 'finalizeStampDither');

    brush.setStampDitherEnabled(true);
    brush.setStampDitherAlgorithm('atkinson');
    brush.setStampDitherPixelSize(2);
    brush.setStampDitherBgFill(false);

    brush.startStroke('layer-1');
    brush.endStroke('layer-1');

    expect(finalizeSpy).toHaveBeenCalled();
    expect(animatorMocks.beginDirectFillMock).toHaveBeenCalled();
    expect(animatorMocks.beginDirectFillMock.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('finalizes error diffusion for sierra-lite stamp dithering on endStroke', () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas, { brushSize: 4, fps: 60 });
    const finalizeSpy = jest.spyOn(stampDither, 'finalizeStampDither');

    brush.setStampDitherEnabled(true);
    brush.setStampDitherAlgorithm('sierra-lite');
    brush.setStampDitherPixelSize(2);
    brush.setStampDitherBgFill(false);

    brush.startStroke('layer-1');
    brush.endStroke('layer-1');

    expect(finalizeSpy).toHaveBeenCalled();
  });

  it.each(['bayer', 'blue-noise', 'void-and-cluster', 'pattern'] as const)(
    'finalizes %s stamp dithering on endStroke',
    (algorithm) => {
      const canvas = makeCanvas();
      const brush = new ColorCycleBrushCanvas2D(canvas, { brushSize: 4, fps: 60 });
      const finalizeSpy = jest.spyOn(stampDither, 'finalizeStampDither');

      brush.setStampDitherEnabled(true);
      brush.setStampDitherAlgorithm(algorithm);
      brush.setStampDitherPixelSize(2);
      brush.setStampDitherBgFill(false);
      if (algorithm === 'pattern') {
        brush.setStampDitherPatternStyle('crosshatch');
      }

      brush.startStroke('layer-1');
      brush.endStroke('layer-1');

      expect(finalizeSpy).toHaveBeenCalled();
      expect(finalizeSpy.mock.calls.at(-1)?.[0].config.algorithm).toBe(algorithm);
    }
  );


  it('rebuilds animator from index snapshot via deserialize', () => {
    const canvas = makeCanvas();
    const indexData = new Uint8Array([1, 0, 0, 0]);

    const serialized = {
      layers: [
        {
          layerId: 'layer-deser',
          data: {
            indexBuffer: {
              width: 2,
              height: 2,
              data: indexData,
              palette: [] as string[],
            },
            gradient: {
              gradientStops: [{ position: 0, color: '#000' }],
            },
            animation: {
              offset: 0,
              stats: { targetFPS: 24 },
            },
          },
          strokeData: {
            paintBuffer: new Uint8Array(0).buffer,
            hasContent: true,
            strokeCounter: 1,
          },
        },
      ],
      cycleSpeed: 0.2,
      fps: 24,
      brushSize: 10,
    };

    const brush = ColorCycleBrushCanvas2D.deserialize(serialized as any, canvas);
    expect(animatorMocks.setIndexBufferFromArrayMock).toHaveBeenCalled();
    const snapshot = brush.getLayerSnapshot('layer-deser');
    expect(snapshot?.hasContent).toBe(true);
  });

  it('keeps persisted color-cycle metadata when store metadata for the layer is still empty', () => {
    const canvas = makeCanvas();
    const { useAppStore } = jest.requireMock('@/stores/useAppStore') as {
      useAppStore: { getState: () => { layers: Array<unknown> } };
    };
    useAppStore.getState().layers = [
      {
        id: 'layer-cold-meta',
        layerType: 'color-cycle',
        colorCycleData: {
          gradientDefs: [],
          slotPalettes: [],
          gradientDefStore: [],
        },
      },
    ];

    const serialized = {
      layers: [
        {
          layerId: 'layer-cold-meta',
          gradientDefs: [{ id: 'gradient-1', currentSlot: 3 }],
          slotPalettes: [
            {
              slot: 3,
              stops: [
                { position: 0, color: '#111111' },
                { position: 1, color: '#eeeeee' },
              ],
            },
          ],
          gradientDefStore: [
            {
              id: 7,
              kind: 'linear',
              slot: 3,
              stops: [
                { position: 0, color: '#111111' },
                { position: 1, color: '#eeeeee' },
              ],
              hash: 'defs-7',
              source: 'manual',
              createdAtMs: 0,
            },
          ],
          nextGradientDefId: 8,
          paintSlot: 3,
          activeGradientId: 'gradient-1',
          strokeData: {
            paintBuffer: new Uint8Array([1, 1, 0, 0]).buffer,
            gradientIdBuffer: new Uint8Array([3, 3, 0, 0]).buffer,
            gradientDefIdBuffer: new Uint16Array([7, 7, 0, 0]).buffer,
            hasContent: true,
            strokeCounter: 1,
          },
        },
      ],
      cycleSpeed: 0.2,
      fps: 24,
      brushSize: 10,
    };

    const brush = ColorCycleBrushCanvas2D.deserialize(serialized as any, canvas);
    const roundTripped = brush.serialize();

    expect(roundTripped.layers[0]?.gradientDefs).toEqual(serialized.layers[0].gradientDefs);
    expect(roundTripped.layers[0]?.slotPalettes).toEqual(serialized.layers[0].slotPalettes);
    expect(roundTripped.layers[0]?.gradientDefStore).toEqual(serialized.layers[0].gradientDefStore);
    expect(roundTripped.layers[0]?.paintSlot).toBe(3);
    expect(roundTripped.layers[0]?.activeGradientId).toBe('gradient-1');
  });

  it('does not let stale store activeGradientId or paintSlot override coherent persisted metadata', () => {
    const canvas = makeCanvas();
    const { useAppStore } = jest.requireMock('@/stores/useAppStore') as {
      useAppStore: { getState: () => { layers: Array<unknown> } };
    };
    useAppStore.getState().layers = [
      {
        id: 'layer-stale-store-meta',
        layerType: 'color-cycle',
        colorCycleData: {
          gradientDefs: [],
          slotPalettes: [],
          gradientDefStore: [],
          paintSlot: 9,
          activeGradientId: 'missing-gradient',
        },
      },
    ];

    const serialized = {
      layers: [
        {
          layerId: 'layer-stale-store-meta',
          gradientDefs: [{ id: 'gradient-1', currentSlot: 3 }],
          slotPalettes: [
            {
              slot: 3,
              stops: [
                { position: 0, color: '#111111' },
                { position: 1, color: '#eeeeee' },
              ],
            },
          ],
          gradientDefStore: [
            {
              id: 7,
              kind: 'linear',
              slot: 3,
              stops: [
                { position: 0, color: '#111111' },
                { position: 1, color: '#eeeeee' },
              ],
              hash: 'defs-7',
              source: 'manual',
              createdAtMs: 0,
            },
          ],
          nextGradientDefId: 8,
          paintSlot: 3,
          activeGradientId: 'gradient-1',
          strokeData: {
            paintBuffer: new Uint8Array([1, 1, 0, 0]).buffer,
            gradientIdBuffer: new Uint8Array([3, 3, 0, 0]).buffer,
            gradientDefIdBuffer: new Uint16Array([7, 7, 0, 0]).buffer,
            hasContent: true,
            strokeCounter: 1,
          },
        },
      ],
      cycleSpeed: 0.2,
      fps: 24,
      brushSize: 10,
    };

    const brush = ColorCycleBrushCanvas2D.deserialize(serialized as any, canvas);
    const roundTripped = brush.serialize();

    expect(roundTripped.layers[0]?.paintSlot).toBe(3);
    expect(roundTripped.layers[0]?.activeGradientId).toBe('gradient-1');
  });

  it('does not let a smaller fallback store palette collapse richer restored metadata', () => {
    const canvas = makeCanvas();
    const { useAppStore } = jest.requireMock('@/stores/useAppStore') as {
      useAppStore: { getState: () => { layers: Array<unknown> } };
    };
    useAppStore.getState().layers = [
      {
        id: 'layer-rich-restored-meta',
        layerType: 'color-cycle',
        colorCycleData: {
          gradientDefs: [{ id: 'g0', currentSlot: 0 }],
          slotPalettes: [{ slot: 0, stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }] }],
          gradientDefStore: [{ id: 1, kind: 'linear', slot: 0, stops: [], hash: 'fallback', source: 'manual', createdAtMs: 0 }],
          nextGradientDefId: 2,
        },
      },
    ];

    const richSlotPalettes = Array.from({ length: 44 }, (_, slot) => ({
      slot,
      stops: [{ position: 0, color: '#111111' }, { position: 1, color: '#eeeeee' }],
    }));
    const richGradientDefStore = Array.from({ length: 44 }, (_, index) => ({
      id: index + 1,
      kind: 'linear',
      slot: index,
      stops: [{ position: 0, color: '#111111' }, { position: 1, color: '#eeeeee' }],
      hash: `rich-${index}`,
      source: 'manual',
      createdAtMs: index,
    }));
    const serialized = {
      layers: [
        {
          layerId: 'layer-rich-restored-meta',
          gradientDefs: [{ id: 'gradient-43', currentSlot: 43 }],
          slotPalettes: richSlotPalettes,
          gradientDefStore: richGradientDefStore,
          nextGradientDefId: 45,
          paintSlot: 43,
          activeGradientId: 'gradient-43',
          strokeData: {
            paintBuffer: new Uint8Array([1, 1, 0, 0]).buffer,
            gradientIdBuffer: new Uint8Array([43, 43, 0, 0]).buffer,
            gradientDefIdBuffer: new Uint16Array([44, 44, 0, 0]).buffer,
            hasContent: true,
            strokeCounter: 43,
          },
        },
      ],
      cycleSpeed: 0.2,
      fps: 24,
      brushSize: 10,
    };

    const brush = ColorCycleBrushCanvas2D.deserialize(serialized as any, canvas);
    const roundTripped = brush.serialize();

    expect(roundTripped.layers[0]?.paintSlot).toBe(43);
    expect(roundTripped.layers[0]?.activeGradientId).toBe('gradient-43');
    expect(roundTripped.layers[0]?.slotPalettes).toHaveLength(44);
    expect(roundTripped.layers[0]?.gradientDefStore).toHaveLength(44);
    expect(roundTripped.layers[0]?.strokeData?.strokeCounter).toBe(43);
  });

  it('keeps new store defs when restored metadata is richer but stale', () => {
    const canvas = makeCanvas();
    const { useAppStore } = jest.requireMock('@/stores/useAppStore') as {
      useAppStore: { getState: () => { layers: Array<unknown> } };
    };
    useAppStore.getState().layers = [
      {
        id: 'layer-committed-def-on-small-store',
        layerType: 'color-cycle',
        colorCycleData: {
          gradientDefs: [{ id: 'g0', currentSlot: 0 }],
          slotPalettes: [
            { slot: 0, stops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }] },
            { slot: 43, stops: [{ position: 0, color: '#123456' }, { position: 1, color: '#abcdef' }] },
          ],
          gradientDefStore: [
            { id: 1, kind: 'linear', slot: 0, stops: [], hash: 'fallback', source: 'manual', createdAtMs: 0 },
            {
              id: 44,
              kind: 'linear',
              slot: 43,
              stops: [{ position: 0, color: '#123456' }, { position: 1, color: '#abcdef' }],
              hash: 'new-committed-def',
              source: 'sampled',
              createdAtMs: 44,
            },
          ],
          nextGradientDefId: 45,
          paintSlot: 43,
          activeGradientId: 'g0',
        },
      },
    ];

    const restoredSlotPalettes = Array.from({ length: 42 }, (_, slot) => ({
      slot,
      stops: [{ position: 0, color: '#111111' }, { position: 1, color: '#eeeeee' }],
    }));
    const restoredGradientDefStore = Array.from({ length: 42 }, (_, index) => ({
      id: index + 1,
      kind: 'linear',
      slot: index,
      stops: [{ position: 0, color: '#111111' }, { position: 1, color: '#eeeeee' }],
      hash: `restored-${index}`,
      source: 'sampled',
      createdAtMs: index,
    }));
    const serialized = {
      layers: [
        {
          layerId: 'layer-committed-def-on-small-store',
          gradientDefs: [{ id: 'g0', currentSlot: 0 }],
          slotPalettes: restoredSlotPalettes,
          gradientDefStore: restoredGradientDefStore,
          nextGradientDefId: 43,
          paintSlot: 43,
          activeGradientId: 'g0',
          strokeData: {
            paintBuffer: new Uint8Array([1, 1, 0, 0]).buffer,
            gradientIdBuffer: new Uint8Array([43, 43, 0, 0]).buffer,
            gradientDefIdBuffer: new Uint16Array([44, 44, 0, 0]).buffer,
            hasContent: true,
            strokeCounter: 44,
          },
        },
      ],
      cycleSpeed: 0.2,
      fps: 24,
      brushSize: 10,
    };

    const brush = ColorCycleBrushCanvas2D.deserialize(serialized as any, canvas);
    const roundTripped = brush.serialize();
    const layer = roundTripped.layers[0];

    expect(layer?.gradientDefStore?.some((entry) => entry.id === 44)).toBe(true);
    expect(layer?.slotPalettes?.some((entry) => entry.slot === 43)).toBe(true);
    expect(layer?.paintSlot).toBe(43);
    expect(layer?.nextGradientDefId).toBe(45);
    expect(Array.from(new Uint16Array(layer?.strokeData?.gradientDefIdBuffer ?? new ArrayBuffer(0))).slice(0, 4)).toEqual([44, 44, 0, 0]);
  });

  it('keeps live store selection while richer restored metadata wins duplicate palette entries', () => {
    const canvas = makeCanvas();
    const { useAppStore } = jest.requireMock('@/stores/useAppStore') as {
      useAppStore: { getState: () => { layers: Array<unknown> } };
    };
    useAppStore.getState().layers = [
      {
        id: 'layer-live-store-edit',
        layerType: 'color-cycle',
        colorCycleData: {
          gradientDefs: [{ id: 'gradient-live', currentSlot: 4 }],
          slotPalettes: [
            {
              slot: 4,
              stops: [{ position: 0, color: '#ff0000' }, { position: 1, color: '#00ff00' }],
            },
          ],
          gradientDefStore: [
            {
              id: 7,
              kind: 'linear',
              slot: 4,
              stops: [{ position: 0, color: '#ff0000' }, { position: 1, color: '#00ff00' }],
              hash: 'live-store-edit',
              source: 'manual',
              createdAtMs: 99,
            },
          ],
          nextGradientDefId: 8,
          paintSlot: 4,
          activeGradientId: 'gradient-live',
        },
      },
    ];

    const restoredSlotPalettes = [
      {
        slot: 4,
        stops: [{ position: 0, color: '#111111' }, { position: 1, color: '#222222' }],
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        slot: index + 10,
        stops: [{ position: 0, color: '#333333' }, { position: 1, color: '#444444' }],
      })),
    ];
    const restoredGradientDefStore = [
      {
        id: 7,
        kind: 'linear',
        slot: 4,
        stops: [{ position: 0, color: '#111111' }, { position: 1, color: '#222222' }],
        hash: 'stale-restored-copy',
        source: 'sampled',
        createdAtMs: 7,
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        id: index + 20,
        kind: 'linear',
        slot: index + 10,
        stops: [{ position: 0, color: '#333333' }, { position: 1, color: '#444444' }],
        hash: `restored-extra-${index}`,
        source: 'sampled',
        createdAtMs: index,
      })),
    ];
    const serialized = {
      layers: [
        {
          layerId: 'layer-live-store-edit',
          gradientDefs: [{ id: 'gradient-live', currentSlot: 4 }],
          slotPalettes: restoredSlotPalettes,
          gradientDefStore: restoredGradientDefStore,
          nextGradientDefId: 28,
          paintSlot: 4,
          activeGradientId: 'gradient-live',
          strokeData: {
            paintBuffer: new Uint8Array([1, 0, 0, 0]).buffer,
            gradientIdBuffer: new Uint8Array([4, 0, 0, 0]).buffer,
            gradientDefIdBuffer: new Uint16Array([7, 0, 0, 0]).buffer,
            hasContent: true,
            strokeCounter: 7,
          },
        },
      ],
      cycleSpeed: 0.2,
      fps: 24,
      brushSize: 10,
    };

    const brush = ColorCycleBrushCanvas2D.deserialize(serialized as any, canvas);
    const layer = brush.serialize().layers[0];

    expect(layer?.activeGradientId).toBe('gradient-live');
    expect(layer?.paintSlot).toBe(4);
    expect(layer?.slotPalettes?.find((entry) => entry.slot === 4)?.stops[0]?.color).toBe('#111111');
    expect(layer?.gradientDefStore?.find((entry) => entry.id === 7)?.hash).toBe('stale-restored-copy');
    expect(layer?.slotPalettes?.some((entry) => entry.slot === 10)).toBe(true);
    expect(layer?.gradientDefStore?.some((entry) => entry.id === 20)).toBe(true);
  });

  it('does not let a stale lower store nextGradientDefId override the persisted counter', () => {
    const canvas = makeCanvas();
    const { useAppStore } = jest.requireMock('@/stores/useAppStore') as {
      useAppStore: { getState: () => { layers: Array<unknown> } };
    };
    useAppStore.getState().layers = [
      {
        id: 'layer-stale-next-def-id',
        layerType: 'color-cycle',
        colorCycleData: {
          gradientDefs: [],
          slotPalettes: [],
          gradientDefStore: [],
          nextGradientDefId: 2,
        },
      },
    ];

    const serialized = {
      layers: [
        {
          layerId: 'layer-stale-next-def-id',
          gradientDefs: [{ id: 'gradient-7', currentSlot: 3 }],
          slotPalettes: [
            {
              slot: 3,
              stops: [
                { position: 0, color: '#111111' },
                { position: 1, color: '#eeeeee' },
              ],
            },
          ],
          gradientDefStore: [
            {
              id: 7,
              kind: 'linear',
              slot: 3,
              stops: [
                { position: 0, color: '#111111' },
                { position: 1, color: '#eeeeee' },
              ],
              hash: 'defs-7',
              source: 'manual',
              createdAtMs: 0,
            },
          ],
          nextGradientDefId: 8,
          paintSlot: 3,
          activeGradientId: 'gradient-7',
          strokeData: {
            paintBuffer: new Uint8Array([1, 1, 0, 0]).buffer,
            gradientIdBuffer: new Uint8Array([3, 3, 0, 0]).buffer,
            gradientDefIdBuffer: new Uint16Array([7, 7, 0, 0]).buffer,
            hasContent: true,
            strokeCounter: 1,
          },
        },
      ],
      cycleSpeed: 0.2,
      fps: 24,
      brushSize: 10,
    };

    const brush = ColorCycleBrushCanvas2D.deserialize(serialized as any, canvas);
    const roundTripped = brush.serialize();

    expect(roundTripped.layers[0]?.nextGradientDefId).toBe(8);
  });

  it('normalizes ArrayBuffer animator data on endStroke', () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas, { brushSize: 4, fps: 60 });
    const animator = (brush as any).getAnimator('layer-1') as { serialize: () => unknown };
    jest.spyOn(animator, 'serialize').mockReturnValue({
      indexBuffer: {
        width: canvas.width,
        height: canvas.height,
        data: new Uint8Array(canvas.width * canvas.height).buffer,
        gradientId: new Uint8Array(canvas.width * canvas.height).buffer,
        speedData: new Uint8Array(canvas.width * canvas.height).buffer,
        palette: [] as string[],
      },
      gradient: {
        gradientStops: [],
        paletteSize: 256,
      },
      animation: {
        offset: 0,
        stats: {
          targetFPS: 0,
          actualFPS: 0,
          frameCount: 0,
          totalTime: 0,
          averageFrameTime: 0,
          isAnimating: false,
        },
      },
    });

    brush.startStroke('layer-1');
    brush.endStroke('layer-1');

    const snapshot = brush.getLayerSnapshot('layer-1');
    expect(snapshot?.paintBuffer.byteLength).toBe(canvas.width * canvas.height);
    const serialized = brush.serialize();
    expect(serialized.layers[0].strokeData?.paintBuffer.byteLength).toBe(canvas.width * canvas.height);
  });

  it('does not let an empty live stroke finalize clear canonical color-cycle layer content', () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas, { brushSize: 4, fps: 60 });
    const updateLayer = jest.fn();
    const { useAppStore } = jest.requireMock('@/stores/useAppStore') as {
      useAppStore: {
        getState: () => {
          layers: Array<unknown>;
          updateLayer?: jest.Mock;
        };
      };
    };
    useAppStore.getState().layers = [
      {
        id: 'layer-cold-canonical',
        layerType: 'color-cycle',
        state: {
          hasContent: true,
          paintRef: 'state/paint.bin',
          gradientIdRef: 'state/gradient-id.bin',
          gradientDefIdRef: 'state/gradient-def-id.bin',
        },
        colorCycleData: {
          repairStatus: {
            ok: false,
            reason: 'missing-gradient-bindings',
          },
        },
      },
    ];
    useAppStore.getState().updateLayer = updateLayer;

    brush.startStroke('layer-cold-canonical');
    brush.endStroke('layer-cold-canonical');

    expect(updateLayer).not.toHaveBeenCalled();
  });

  it('allows a fresh blank color-cycle layer with allocated zero buffers to sync empty state', () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas, { brushSize: 4, fps: 60 });
    const updateLayer = jest.fn();
    const { useAppStore } = jest.requireMock('@/stores/useAppStore') as {
      useAppStore: {
        getState: () => {
          layers: Array<unknown>;
          updateLayer?: jest.Mock;
        };
      };
    };
    useAppStore.getState().layers = [
      {
        id: 'layer-fresh-blank',
        layerType: 'color-cycle',
        colorCycleData: {
          hasContent: false,
          gradientIdBuffer: new Uint8Array(canvas.width * canvas.height).buffer,
          gradientDefIdBuffer: new Uint16Array(canvas.width * canvas.height).buffer,
          brushState: {
            layers: [
              {
                strokeData: {
                  hasContent: false,
                  paintBuffer: new Uint8Array(canvas.width * canvas.height).buffer,
                  gradientIdBuffer: new Uint8Array(canvas.width * canvas.height).buffer,
                  gradientDefIdBuffer: new Uint16Array(canvas.width * canvas.height).buffer,
                },
              },
            ],
          },
        },
      },
    ];
    useAppStore.getState().updateLayer = updateLayer;

    brush.startStroke('layer-fresh-blank');
    brush.endStroke('layer-fresh-blank');

    expect(updateLayer).toHaveBeenCalledWith('layer-fresh-blank', {
      colorCycleData: expect.objectContaining({
        hasContent: false,
      }),
    });
  });

  it('does not let an empty live stroke clear string-backed brush-state content', () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas, { brushSize: 4, fps: 60 });
    const updateLayer = jest.fn();
    const { useAppStore } = jest.requireMock('@/stores/useAppStore') as {
      useAppStore: {
        getState: () => {
          layers: Array<unknown>;
          updateLayer?: jest.Mock;
        };
      };
    };
    useAppStore.getState().layers = [
      {
        id: 'layer-string-brush-state',
        layerType: 'color-cycle',
        colorCycleData: {
          hasContent: false,
          brushState: {
            layers: [
              {
                strokeData: {
                  hasContent: false,
                  paintBuffer: 'archive/paint.bin',
                  gradientIdBuffer: '',
                  gradientDefIdBuffer: '',
                },
              },
            ],
          },
        },
      },
    ];
    useAppStore.getState().updateLayer = updateLayer;

    brush.startStroke('layer-string-brush-state');
    brush.endStroke('layer-string-brush-state');

    expect(updateLayer).not.toHaveBeenCalled();
  });

  it('forces full-size animator before restore upload', () => {
    const canvas = makeCanvas();
    canvas.width = 512;
    canvas.height = 512;
    const brush = new ColorCycleBrushCanvas2D(canvas);
    (brush as any).createAnimator('layer-restore', { initial: 'reduced' });
    const full = new Uint8Array(canvas.width * canvas.height);
    full[0] = 1;

    brush.applyLayerSnapshot('layer-restore', {
      paintBuffer: full.buffer,
      hasContent: true,
      strokeCounter: 1,
    });

    expect(animatorMocks.resizeMock).toHaveBeenCalledWith(canvas.width, canvas.height);
    const applied = animatorMocks.setIndexBufferFromArrayMock.mock.calls.slice(-1)[0][0] as Uint8Array;
    expect(applied.length).toBe(canvas.width * canvas.height);
  });

  it('prefers gradientBands over distance-derived bands', () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas);

    brush.setGradientBands(18);
    const derived = (brush as any).deriveBandCountFromDistance(320, 8);

    expect(derived).toBe(18);
  });

  it('accepts gradientBands=1 without warning spam', () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    brush.setGradientBands(1);
    const derived = (brush as any).deriveBandCountFromDistance(320, 8);

    expect(derived).toBe(2);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('maps stroke band indices using gradientBands', () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas);
    const strokeData = (brush as any).ensureStrokeState('layer-1');

    brush.setGradientBands(4);
    strokeData.strokePhaseUnits = 0;
    const first = (brush as any).computeColorBandIndex(strokeData);

    strokeData.strokePhaseUnits = 85;
    const mid = (brush as any).computeColorBandIndex(strokeData);

    strokeData.strokePhaseUnits = 170;
    const nearEnd = (brush as any).computeColorBandIndex(strokeData);

    expect(first).not.toBe(mid);
    expect(mid).not.toBe(nearEnd);
  });

  it('keeps total cycle length constant when bands change', () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas);
    const strokeData = (brush as any).ensureStrokeState('layer-1');

    brush.setGradientBands(4);
    strokeData.strokePhaseUnits = 0;
    const band4Start = (brush as any).computeColorBandIndex(strokeData);
    strokeData.strokePhaseUnits = 127;
    const band4Mid = (brush as any).computeColorBandIndex(strokeData);

    brush.setGradientBands(12);
    strokeData.strokePhaseUnits = 0;
    const band12Start = (brush as any).computeColorBandIndex(strokeData);
    strokeData.strokePhaseUnits = 127;
    const band12Mid = (brush as any).computeColorBandIndex(strokeData);

    expect(band4Mid).not.toBe(band4Start);
    expect(band12Mid).not.toBe(band12Start);
  });

  it('uses the same speed byte for sierra-lite cc gradient fills as stroke mode', () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas);
    const strokeData = (brush as any).ensureStrokeState('layer-1');

    brush.setSpeed(0.1);
    strokeData.strokeCounter = 1;
    (brush as any).strokeCounter = 1;
    strokeData.strokeCycleSpeed = (brush as any).getResolvedWriteCycleSpeed();
    strokeData.strokeSpeedByte = (brush as any).getWriteSpeedByte(strokeData);

    const strokeSpeedByte = (brush as any).getWriteSpeedByte(strokeData);
    const gradientSpeedByte = (brush as any).getCcGradientFillSpeedByte(strokeData, {
      ditherAlgorithm: 'sierra-lite',
      pairBandCount: 0,
    });

    expect(gradientSpeedByte).toBe(strokeSpeedByte);
  });

  it('keeps cc gradient fill speed aligned with stroke speed for paired bands too', () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas);
    const strokeData = (brush as any).ensureStrokeState('layer-1');

    brush.setSpeed(0.1);
    strokeData.strokeCounter = 2;
    (brush as any).strokeCounter = 2;
    strokeData.strokeCycleSpeed = (brush as any).getResolvedWriteCycleSpeed();
    strokeData.strokeSpeedByte = (brush as any).getWriteSpeedByte(strokeData);

    const strokeSpeedByte = (brush as any).getWriteSpeedByte(strokeData);
    const gradientSpeedByte = (brush as any).getCcGradientFillSpeedByte(strokeData, {
      ditherAlgorithm: 'sierra-lite',
      pairBandCount: 2,
    });

    expect(gradientSpeedByte).toBe(strokeSpeedByte);
  });

  it('fills linear gradients continuously when requested', async () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas);

    brush.setGradientBands(4);
    brush.setDitherEnabled(false);

    const vertices = [
      { x: 0, y: 0 },
      { x: 7, y: 0 },
      { x: 7, y: 5 },
      { x: 0, y: 5 },
    ];

    await brush.fillShapeLinear(vertices, { x: 1, y: 0 }, 'layer-1', 4, { continuous: true });

    const animator = (brush as any).getAnimator('layer-1');
    const indexBuffer = animator?.indexBuffer as Uint8Array;
    const unique = new Set(Array.from(indexBuffer || []).filter((v) => v > 0));

    expect(unique.size).toBeGreaterThan(4);
  });

  it('does not cap continuous linear cc gradient fills at 64 bands', async () => {
    const canvas = makeCanvas();
    canvas.width = 256;
    canvas.height = 32;
    const brush = new ColorCycleBrushCanvas2D(canvas);

    brush.setGradientBands(128);
    brush.setDitherEnabled(false);

    const vertices = [
      { x: 0, y: 0 },
      { x: 255, y: 0 },
      { x: 255, y: 31 },
      { x: 0, y: 31 },
    ];

    await brush.fillShapeLinear(vertices, { x: 1, y: 0 }, 'layer-1', 1, {
      continuous: true,
      ccGradient: true,
      ditherPairBandCount: 2,
    });

    const animator = (brush as any).getAnimator('layer-1');
    const indexBuffer = animator?.indexBuffer as Uint8Array;
    const unique = new Set(Array.from(indexBuffer || []).filter((v) => v > 0));

    expect(unique.size).toBeGreaterThan(64);
  });

  it('resolves shape phase bytes only for phased cc gradient fills', () => {
    const brush = new ColorCycleBrushCanvas2D(makeCanvas());

    expect((brush as any).resolveShapePhaseByte(0.5, { ccGradient: false, pairBandCount: 2 })).toBe(0);
    expect((brush as any).resolveShapePhaseByte(0.5, { ccGradient: true, pairBandCount: 1 })).toBe(0);
    expect((brush as any).resolveShapePhaseByte(0, { ccGradient: true, pairBandCount: 2 })).toBe(0);
    expect((brush as any).resolveShapePhaseByte(0.5, { ccGradient: true, pairBandCount: 2 })).toBe(1);
    expect((brush as any).resolveShapePhaseByte(0.5, { ccGradient: true, effectiveColorCount: 4 })).toBe(1);
    expect((brush as any).resolveShapePhaseByte(0.5, {
      ccGradient: true,
      pairBandCount: 2,
      shapePhaseBaseByte: 17,
    })).toBe(17);
  });

  it('writes a stable per-shape phase offset for non-dither concentric cc gradient fills', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    canvas.getContext = jest.fn(() => ({
      clearRect: jest.fn(),
      drawImage: jest.fn(),
      putImageData: jest.fn(),
      getImageData: jest.fn(() => ({
        data: new Uint8ClampedArray(canvas.width * canvas.height * 4),
        width: canvas.width,
        height: canvas.height,
      })),
      save: jest.fn(),
      restore: jest.fn(),
    })) as any;
    const brush = new ColorCycleBrushCanvas2D(canvas);

    brush.setSpeed(0.1);
    brush.setGradientBands(4);
    brush.setDitherEnabled(false);
    concentricFillMocks.fillConcentricIndices.mockImplementationOnce(
      async (
        _job: unknown,
        callbacks: { writeSample: (x: number, y: number, colorIndex: number) => void }
      ) => {
        for (let y = 0; y < canvas.height; y += 1) {
          for (let x = 0; x < canvas.width; x += 1) {
            const colorIndex = x < canvas.width / 2 ? 1 : 128;
            callbacks.writeSample(x, y, colorIndex);
          }
        }
      }
    );

    const vertices = [
      { x: 0, y: 0 },
      { x: 31, y: 0 },
      { x: 31, y: 31 },
      { x: 0, y: 31 },
    ];

    await brush.fillShapeDispatch({
      mode: 'concentric',
      vertices,
      layerId: 'layer-1',
      options: {
        ccGradient: true,
        spacing: 1,
        ditherPairBandCount: 2,
      },
    });

    const animator = (brush as any).getAnimator('layer-1');
    const speedData = Array.from((animator?.speedData as Uint8Array) ?? []).filter((value) => value > 0);
    const phaseData = Array.from((animator?.phaseData as Uint8Array) ?? []).filter((value) => value > 0);

    expect(new Set(speedData).size).toBe(1);
    expect(new Set(phaseData).size).toBe(1);
  });

  it('derives different stable base phases for different shape seeds', () => {
    const brush = new ColorCycleBrushCanvas2D(makeCanvas());

    const phaseA = (brush as any).resolveShapePhaseBaseByte({
      ccGradient: true,
      pairBandCount: 2,
      markId: 'shape-a',
      bounds: { minX: 0, minY: 0, width: 10, height: 10 },
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    });
    const phaseB = (brush as any).resolveShapePhaseBaseByte({
      ccGradient: true,
      pairBandCount: 2,
      markId: 'shape-b',
      bounds: { minX: 0, minY: 0, width: 10, height: 10 },
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    });

    expect(phaseA).toBeGreaterThanOrEqual(0);
    expect(phaseA).toBeLessThanOrEqual(223);
    expect(phaseB).toBeGreaterThanOrEqual(0);
    expect(phaseB).toBeLessThanOrEqual(223);
    expect(phaseA).not.toBe(phaseB);
  });

  it('applies perceptual dithering for continuous linear fills when enabled', async () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas);

    brush.setDitherEnabled(true);
    brush.setPerceptualDither(true);
    fillDitherMocks.fillLinear.mockClear();

    const vertices = [
      { x: 0, y: 0 },
      { x: 7, y: 0 },
      { x: 7, y: 5 },
      { x: 0, y: 5 },
    ];

    await brush.fillShapeLinear(vertices, { x: 1, y: 0 }, 'layer-1', 4, { continuous: true });

    expect(fillDitherMocks.fillLinear).toHaveBeenCalled();
  });

  it('uses selected dither algorithm/pattern for continuous linear cc gradient fills', async () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas);

    brush.setDitherEnabled(true);
    brush.setPerceptualDither(false);
    brush.setStampDitherAlgorithm('floyd-steinberg');
    brush.setStampDitherPatternStyle('crosshatch');
    ccGradientDitherMocks.fillCcGradientDither.mockClear();

    const vertices = [
      { x: 0, y: 0 },
      { x: 7, y: 0 },
      { x: 7, y: 5 },
      { x: 0, y: 5 },
    ];

    await brush.fillShapeLinear(vertices, { x: 1, y: 0 }, 'layer-1', 4, {
      continuous: true,
      ccGradient: true,
      ditherPixelSize: 3,
    });

    expect(ccGradientDitherMocks.fillCcGradientDither).toHaveBeenCalledWith(
      expect.objectContaining({
        algorithm: 'floyd-steinberg',
        patternStyle: 'crosshatch',
      })
    );
  });

  it('forwards dither pattern diversity for continuous linear cc gradient fills', async () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas);

    brush.setDitherEnabled(true);
    ccGradientDitherMocks.fillCcGradientDither.mockClear();

    const vertices = [
      { x: 0, y: 0 },
      { x: 7, y: 0 },
      { x: 7, y: 5 },
      { x: 0, y: 5 },
    ];

    await brush.fillShapeLinear(vertices, { x: 1, y: 0 }, 'layer-1', 4, {
      continuous: true,
      ccGradient: true,
      ditherPatternDiversity: 25,
    });

    expect(ccGradientDitherMocks.fillCcGradientDither).toHaveBeenCalledWith(
      expect.objectContaining({
        ditherPatternDiversity: 25,
      })
    );
  });

  it('uses selected dither algorithm/pattern for continuous concentric cc gradient fills', async () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas);

    brush.setDitherEnabled(true);
    brush.setPerceptualDither(false);
    brush.setStampDitherAlgorithm('atkinson');
    brush.setStampDitherPatternStyle('lines');
    ccGradientDitherMocks.fillCcGradientDither.mockClear();

    const vertices = [
      { x: 0, y: 0 },
      { x: 7, y: 0 },
      { x: 7, y: 5 },
      { x: 0, y: 5 },
    ];

    await brush.fillShapeDispatch({
      mode: 'concentric',
      vertices,
      layerId: 'layer-1',
      options: {
        ccGradient: true,
        ditherPixelSize: 2,
        ditherLevels: 4,
      },
    });

    expect(ccGradientDitherMocks.fillCcGradientDither).toHaveBeenCalledWith(
      expect.objectContaining({
        algorithm: 'atkinson',
        patternStyle: 'lines',
        levels: 4,
        pairBandCount: 0,
      })
    );
  });

  it('honors explicit ditherLevels for linear cc gradient fills without pair-band mode', async () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas);

    brush.setDitherEnabled(true);
    ccGradientDitherMocks.fillCcGradientDither.mockClear();

    const vertices = [
      { x: 0, y: 0 },
      { x: 7, y: 0 },
      { x: 7, y: 5 },
      { x: 0, y: 5 },
    ];

    await brush.fillShapeLinear(vertices, { x: 1, y: 0 }, 'layer-1', 4, {
      continuous: true,
      ccGradient: true,
      ditherLevels: 6,
    });

    expect(ccGradientDitherMocks.fillCcGradientDither).toHaveBeenCalledWith(
      expect.objectContaining({
        levels: 6,
        pairBandCount: 0,
      })
    );
  });

  it('clamps dither settings', () => {
    const brush = new ColorCycleBrushCanvas2D(makeCanvas());
    brush.setDitherStrength(2);
    brush.setDitherPixelSize(0.4);
    const internals = brush as any;
    expect(internals.ditherStrength).toBe(1);
    expect(internals.ditherPixelSize).toBe(1);
    brush.setDitherStrength(-1);
    brush.setDitherPixelSize(5.6);
    expect(internals.ditherStrength).toBe(0);
    expect(internals.ditherPixelSize).toBe(5);
  });

  it('keeps color-cycle stroke pressure size continuous without integer jumps', () => {
    pressureCurveMocks.applyPressureCurve.mockImplementation(
      (pressure: number, minPercent: number, maxPercent: number, curveType: string) => {
        expect(curveType).toBe('linear');
        const p = Math.max(0, Math.min(1, pressure));
        const min = minPercent / 100;
        const max = maxPercent / 100;
        return min + (max - min) * p;
      }
    );

    const brush = new ColorCycleBrushCanvas2D(makeCanvas(), { brushSize: 20 });
    brush.setPressureEnabled(true);
    brush.setMinPressure(100);
    brush.setMaxPressure(300);

    const sizeA = (brush as any).resolvePressureBrushSize(0.49) as number;
    const sizeB = (brush as any).resolvePressureBrushSize(0.53) as number;
    const sizeC = (brush as any).resolvePressureBrushSize(0.57) as number;

    expect(sizeA).toBeLessThan(sizeB);
    expect(sizeB).toBeLessThan(sizeC);
    expect(sizeB % 1).not.toBe(0);
  });

  it('applies commit opacity in commitToLayer and restores previous context alpha', () => {
    const brush = new ColorCycleBrushCanvas2D(makeCanvas(), { brushSize: 4, fps: 60 });
    const layerId = 'layer-opacity';
    const paint = new Uint8Array(8 * 6);
    paint[0] = 1;
    brush.applyLayerSnapshot(layerId, {
      paintBuffer: paint.buffer,
      hasContent: true,
      strokeCounter: 1,
    });

    const ctx: Partial<CanvasRenderingContext2D> & Record<string, unknown> = {
      globalCompositeOperation: 'multiply',
      globalAlpha: 0.77,
      imageSmoothingEnabled: true,
      save: jest.fn(),
      restore: jest.fn(),
      setTransform: jest.fn(),
      clearRect: jest.fn(),
      drawImage: jest.fn(),
    };
    const targetCanvas = {
      width: 8,
      height: 6,
      getContext: jest.fn(() => ctx),
    } as unknown as HTMLCanvasElement;

    let alphaDuringRender = -1;
    const renderSpy = jest
      .spyOn(brush as unknown as { renderAnimatorToContext: (...args: unknown[]) => void }, 'renderAnimatorToContext')
      .mockImplementation((...args: unknown[]) => {
        const renderCtx = args[1] as CanvasRenderingContext2D;
        alphaDuringRender = renderCtx.globalAlpha;
      });

    brush.commitToLayer(targetCanvas, layerId, 0.35);

    expect(alphaDuringRender).toBeCloseTo(0.35, 5);
    expect(ctx.globalAlpha).toBe(0.77);
    expect(ctx.globalCompositeOperation).toBe('multiply');
    renderSpy.mockRestore();
  });
});
