/* eslint-disable @typescript-eslint/no-explicit-any */
import { ColorCycleBrushCanvas2D } from '../ColorCycleBrushCanvas2D';
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

    setIndexBufferFromArray(arr: Uint8Array, gradientId?: Uint8Array, speedData?: Uint8Array) {
      this.indexBuffer = arr;
      if (gradientId) {
        this.gradientId = gradientId;
      }
      if (speedData) {
        this.speedData = speedData;
      }
      setIndexBufferFromArrayMock(arr, gradientId, speedData);
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
      return {
        data: this.indexBuffer,
        gradientId: this.gradientId,
        speedData: this.speedData,
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
    brush.setStampDitherBgFill(false);
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
    expect(serialized.stampDitherBgFill).toBe(false);
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

  it('finalizes error diffusion stamp dithering on endStroke', () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas, { brushSize: 4, fps: 60 });

    brush.setStampDitherEnabled(true);
    brush.setStampDitherAlgorithm('sierra-lite');
    brush.setStampDitherPixelSize(2);
    brush.setStampDitherBgFill(false);

    brush.startStroke('layer-1');
    brush.endStroke('layer-1');

    expect(animatorMocks.beginDirectFillMock).toHaveBeenCalled();
    expect(animatorMocks.beginDirectFillMock.mock.calls.length).toBeGreaterThanOrEqual(1);
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

  it('forces full-size animator before restore upload', () => {
    const canvas = makeCanvas();
    canvas.width = 512;
    canvas.height = 512;
    const brush = new ColorCycleBrushCanvas2D(canvas);
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

  it('maps stroke band indices using gradientBands', () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas);
    const strokeData = (brush as any).ensureStrokeState('layer-1');

    brush.setGradientBands(4);
    strokeData.stampCounter = 0;
    const first = (brush as any).computeColorBandIndex(strokeData);

    strokeData.stampCounter = 85;
    const mid = (brush as any).computeColorBandIndex(strokeData);

    strokeData.stampCounter = 170;
    const nearEnd = (brush as any).computeColorBandIndex(strokeData);

    expect(first).not.toBe(mid);
    expect(mid).not.toBe(nearEnd);
  });

  it('keeps total cycle length constant when bands change', () => {
    const canvas = makeCanvas();
    const brush = new ColorCycleBrushCanvas2D(canvas);
    const strokeData = (brush as any).ensureStrokeState('layer-1');

    brush.setGradientBands(4);
    strokeData.stampCounter = 0;
    const band4Start = (brush as any).computeColorBandIndex(strokeData);
    strokeData.stampCounter = 127;
    const band4Mid = (brush as any).computeColorBandIndex(strokeData);

    brush.setGradientBands(12);
    strokeData.stampCounter = 0;
    const band12Start = (brush as any).computeColorBandIndex(strokeData);
    strokeData.stampCounter = 127;
    const band12Mid = (brush as any).computeColorBandIndex(strokeData);

    expect(band4Mid).not.toBe(band4Start);
    expect(band12Mid).not.toBe(band12Start);
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
