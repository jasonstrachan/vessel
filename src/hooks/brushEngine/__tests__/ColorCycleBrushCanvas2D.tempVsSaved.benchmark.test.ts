import { ColorCycleBrushCanvas2D } from '../ColorCycleBrushCanvas2D';

type MockContext = CanvasRenderingContext2D;

const makeMockContext = (canvas: HTMLCanvasElement): MockContext => {
  const createImageData = (w: number, h: number) => ({
    data: new Uint8ClampedArray(Math.max(0, w * h * 4)),
    width: w,
    height: h,
  });
  return {
    canvas,
    imageSmoothingEnabled: false,
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    createImageData: jest.fn(createImageData),
    getImageData: jest.fn((_x: number, _y: number, w: number, h: number) => createImageData(w, h)),
    putImageData: jest.fn(),
    clearRect: jest.fn(),
    drawImage: jest.fn(),
    setTransform: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    rotate: jest.fn(),
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

jest.mock('@/stores/useAppStore', () => {
  const state = { layers: [], tools: { brushSettings: {} } };
  const useAppStore = <T,>(selector?: (s: typeof state) => T) =>
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

describe('ColorCycleBrushCanvas2D temp vs saved benchmark', () => {
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

  it('benchmarks temp-like vs saved-like custom stamp throughput', () => {
    const canvas = makeCanvas(128, 128);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-bench';
    brush.setBrushSize(32);
    brush.setSpeed(0.5);

    const imageData = new ImageData(64, 64);
    for (let i = 0; i < imageData.data.length; i += 4) {
      imageData.data[i] = 255;
      imageData.data[i + 3] = 255;
    }

    const tempStamp = {
      imageData,
      width: 64,
      height: 64,
      cacheKey: 'temp:bench:64x64:abc12345',
    };
    const savedStamp = {
      imageData,
      width: 64,
      height: 64,
      cacheKey: 'project:bench:64x64:abc12345',
    };

    const run = (stamp: typeof tempStamp, iterations: number): number => {
      brush.startStroke(layerId);
      const start = performance.now();
      for (let i = 0; i < iterations; i += 1) {
        const x = 16 + (i % 80);
        const y = 16 + ((i * 3) % 80);
        brush.paintCustomStamp(stamp, x, y, layerId, 1, 0, 0.5);
      }
      brush.endStroke(layerId);
      return performance.now() - start;
    };

    // Warm-up
    run(tempStamp, 100);
    run(savedStamp, 100);

    const tempMs = run(tempStamp, 1500);
    const savedMs = run(savedStamp, 1500);
    const ratio = savedMs / Math.max(0.0001, tempMs);

    console.log('[bench] temp-vs-saved', {
      tempMs: Number(tempMs.toFixed(2)),
      savedMs: Number(savedMs.toFixed(2)),
      ratio: Number(ratio.toFixed(3)),
    });

    expect(Number.isFinite(ratio)).toBe(true);
  });
});
