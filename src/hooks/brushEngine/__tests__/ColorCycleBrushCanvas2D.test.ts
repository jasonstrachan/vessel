/* eslint-disable @typescript-eslint/no-explicit-any */
import { ColorCycleBrushCanvas2D } from '../ColorCycleBrushCanvas2D';
const animatorMocks = jest.requireMock('@/lib/ColorCycleAnimator').__mocks__ as {
  setIndexBufferFromArrayMock: jest.Mock;
  deserializeSpy: jest.Mock;
};

jest.mock('@/lib/ColorCycleAnimator', () => {
  const setIndexBufferFromArrayMock = jest.fn();

  const deserializeSpy = jest.fn();

  class MockAnimator {
    width: number;
    height: number;
    fps: number;
    indexBuffer?: Uint8Array;

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
      this.width = w;
      this.height = h;
    }

    setIndexBufferFromArray(arr: Uint8Array, gradientId?: Uint8Array) {
      this.indexBuffer = arr;
      setIndexBufferFromArrayMock(arr, gradientId);
    }

    setFlowMode() {}

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
  }

  return {
    ColorCycleAnimator: MockAnimator,
    __mocks__: { setIndexBufferFromArrayMock, deserializeSpy },
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
  ccLog: jest.fn(),
  ccWarn: jest.fn(),
}));

jest.mock('@/layers/MaskManager', () => ({
  getMaskManager: jest.fn(() => ({ applyMask: jest.fn() })),
}));

jest.mock('@/utils/perf/ccPerfProbe', () => ({
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

jest.mock('../dithering', () => ({
  applyDithering: jest.fn((imageData: ImageData) => imageData),
  applyDitheringWithFillResolution: jest.fn(),
}));

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

    brush.setStampShape('triangle');
    brush.setStampDitherEnabled(true);
    brush.setStampDitherPixelSize(3);
    brush.setStampDitherAlgorithm('pattern');
    brush.setStampDitherPatternStyle('crosshatch');
    brush.setStampDitherClears(true);
    brush.setStampDitherPressureLinked(true);

    const serialized = brush.serialize();

    expect(serialized.layers).toHaveLength(1);
    const strokeData = serialized.layers[0].strokeData;
    expect(strokeData?.strokeCounter).toBe(7);
    expect(strokeData?.paintBuffer.byteLength).toBe(paint.byteLength);
    expect(serialized.stampShape).toBe('triangle');
    expect(serialized.stampDitherPixelSize).toBe(3);
    expect(serialized.stampDitherAlgorithm).toBe('pattern');
    expect(serialized.stampDitherPatternStyle).toBe('crosshatch');
    expect(serialized.stampDitherClears).toBe(true);
    expect(serialized.stampDitherPressureLinked).toBe(true);

    const roundTripped = ColorCycleBrushCanvas2D.deserialize(serialized, makeCanvas());
    const snapshot = roundTripped.getLayerSnapshot('layer-1');
    expect(snapshot?.strokeCounter).toBe(7);
    expect(new Uint8Array(snapshot!.paintBuffer)[0]).toBe(5);
    expect(roundTripped.serialize().stampDitherAlgorithm).toBe('pattern');
    expect(roundTripped.serialize().stampDitherPatternStyle).toBe('crosshatch');
    expect(roundTripped.serialize().stampDitherPressureLinked).toBe(true);
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
});
