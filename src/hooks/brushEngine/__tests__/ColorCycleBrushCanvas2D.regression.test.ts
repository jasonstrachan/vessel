import { pointInPolygon } from '@/shapeFill/utils/geometry';
import { ColorCycleBrushCanvas2D } from '../ColorCycleBrushCanvas2D';
import { encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';
import { useAppStore } from '@/stores/useAppStore';

type MockContext = CanvasRenderingContext2D & {
  _lastImageData?: ImageData;
};

const makeMockContext = (canvas: HTMLCanvasElement): MockContext => {
  const createImageData = (w: number, h: number) => ({
    data: new Uint8ClampedArray(Math.max(0, w * h * 4)),
    width: w,
    height: h,
  });
  const ctx = {
    canvas,
    imageSmoothingEnabled: false,
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    createImageData: jest.fn(createImageData),
    getImageData: jest.fn((x: number, y: number, w: number, h: number) => createImageData(w, h)),
    putImageData: jest.fn(),
    clearRect: jest.fn(),
    drawImage: jest.fn(),
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

  it('applies speed changes only to newly written pixels', () => {
    const canvas = makeCanvas(16, 16);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-speed-write-only';
    brush.setBrushSize(1);

    const firstSpeed = 0.2;
    const secondSpeed = 1.6;
    const firstExpectedByte = encodeColorCycleSpeedByte(firstSpeed);
    const secondExpectedByte = encodeColorCycleSpeedByte(secondSpeed);

    brush.setSpeed(firstSpeed);
    brush.startStroke(layerId);
    brush.paint(2, 2, layerId, 1);
    brush.endStroke(layerId);

    const animator = (brush as unknown as {
      animators: Map<string, { getIndexBuffers: () => { data: Uint8Array; spd?: Uint8Array } }>;
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
    expect(afterFirst[firstIndex]).toBe(firstExpectedByte);

    brush.setSpeed(secondSpeed);
    brush.startStroke(layerId);
    brush.paint(12, 12, layerId, 1);
    brush.endStroke(layerId);

    const afterSecond = animator.getIndexBuffers().spd;
    if (!afterSecond) {
      throw new Error('Missing speed buffer after second stroke');
    }
    expect(afterSecond[firstIndex]).toBe(firstExpectedByte);
    expect(afterSecond[secondIndex]).toBe(secondExpectedByte);
  });

  it('keeps write-speed bytes stable while velocity influences phase progression', () => {
    const state = useAppStore.getState();
    state.tools.brushSettings.velocityAnimationSpeedEnabled = true;

    const canvas = makeCanvas(16, 16);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });
    const layerId = 'layer-velocity-animation';
    brush.setBrushSize(1);
    brush.setGradientBands(254);
    brush.setSpeed(0.2);

    const baseSpeedByte = encodeColorCycleSpeedByte(0.2);

    brush.startStroke(layerId);
    brush.paint(2, 2, layerId, 1);
    brush.paint(14, 2, layerId, 1, 0, 2.5);
    brush.endStroke(layerId);

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
    const idx = animator.getIndexBuffers().data;
    if (!idx) {
      throw new Error('Missing index buffer for velocity animation speed test');
    }

    const firstIndex = 2 + 2 * canvas.width;
    const secondIndex = 14 + 2 * canvas.width;
    expect(spd[firstIndex]).toBe(baseSpeedByte);
    expect(spd[secondIndex]).toBe(baseSpeedByte);
    expect(idx[secondIndex]).toBeGreaterThan(idx[firstIndex]);

    state.tools.brushSettings.velocityAnimationSpeedEnabled = false;
  });

  it('reduces phase advance at higher velocity when velocity animation toggle is enabled', () => {
    const state = useAppStore.getState();
    state.tools.brushSettings.velocityAnimationSpeedEnabled = true;

    const canvas = makeCanvas(16, 16);
    const brush = new ColorCycleBrushCanvas2D(canvas, { forceCanvas2D: true });

    const lowSpeedAdvance = (brush as unknown as {
      resolvePhaseAdvancePerStamp: (speedSamplePxPerMs?: number) => number;
    }).resolvePhaseAdvancePerStamp(0.1);
    const highSpeedAdvance = (brush as unknown as {
      resolvePhaseAdvancePerStamp: (speedSamplePxPerMs?: number) => number;
    }).resolvePhaseAdvancePerStamp(2.5);

    expect(lowSpeedAdvance).toBeGreaterThan(highSpeedAdvance);
    state.tools.brushSettings.velocityAnimationSpeedEnabled = false;
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
});
