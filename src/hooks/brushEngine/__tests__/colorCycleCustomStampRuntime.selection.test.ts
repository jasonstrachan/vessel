import studioExtension from '@/extensions/studioExtension';
import type { StudioStrokePaintMask } from '@/extensions/studioExtensionTypes';
import { applyColorCycleBrushLayerSnapshotToRuntime } from '@/lib/colorCycle/document';
import { readTestColorCycleBrushLayerSnapshot } from '@/testing/colorCycleSnapshotTestUtils';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape } from '@/types';
import type { SelectionRasterScopeInput } from '@/stores/helpers/selectionRoi';

import { ColorCycleBrushCanvas2D } from '../ColorCycleBrushCanvas2D';
import { createColorCycleStrokeMaskHealer } from '../colorCycleStrokeMaskHeal';

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


type TestStore = Partial<SelectionRasterScopeInput> & {
  selectionMaskLayerId?: string;
  layers: Array<Record<string, unknown>>;
  tools: { currentTool: string; brushSettings: Record<string, unknown> };
};
jest.mock('@/stores/useAppStore', () => {
  const state: TestStore = { layers: [], tools: { currentTool: 'brush', brushSettings: {} } };
  const useAppStore = <T,>(selector?: (s: TestStore) => T) => selector ? selector(state) : state as T;
  useAppStore.getState = () => state;
  useAppStore.setState = jest.fn();
  useAppStore.subscribe = jest.fn(() => () => {});
  return { useAppStore };
});
jest.mock('@/extensions/studioExtension', () => ({ __esModule: true, default: { brushPresets: [] } }));
jest.mock('@/utils/canvasPool', () => ({ canvasPool: {
  acquire: (width: number, height: number) => makeCanvas(width, height), release: jest.fn(),
} }));

const fields = ['paintBuffer', 'gradientIdBuffer', 'gradientDefIdBuffer', 'speedBuffer', 'flowBuffer', 'phaseBuffer'] as const;
const width = 24, height = 12, length = width * height;
const baseline = () => ({
  paintBuffer: new Uint8Array(length).fill(200).buffer,
  gradientIdBuffer: new Uint8Array(length).fill(3).buffer,
  gradientDefIdBuffer: new Uint16Array(length).fill(9).buffer,
  speedBuffer: new Uint8Array(length).fill(17).buffer,
  flowBuffer: new Uint8Array(length).fill(1).buffer,
  phaseBuffer: new Uint8Array(length).fill(29).buffer,
  hasContent: true, strokeCounter: 1,
});
const stamp = (captured: boolean) => ({
  imageData: new ImageData(new Uint8ClampedArray(8 * 4 * 4).fill(255), 8, 4),
  width: 8, height: 4, cacheKey: 'selection-custom-tip',
  ...(captured ? { colorCycle: {
    schemaVersion: 2 as const, mode: 'captured-data' as const, sourceCycleLength: 256,
    mapWidth: 8, mapHeight: 4, phaseMap: new Uint16Array(32).fill(48),
  } } : {}),
});
const selected = (x: number, y: number) => x >= 4 && x < 20 && y >= 2 && y < 10 && !(x >= 10 && x < 14);
const setSelection = (alpha: number, outside = false) => {
  const state = useAppStore.getState() as unknown as TestStore;
  state.selectionMaskLayerId = 'different-layer-owner';
  state.selectionStart = { x: 0, y: 0 }; state.selectionEnd = { x: width, y: height };
  const data = new Uint8ClampedArray(16 * 8 * 4);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) data[(y * 16 + x) * 4 + 3] = x >= 6 && x < 10 ? 0 : alpha;
  state.selectionMask = { width: 16, height: 8, data, colorSpace: 'srgb' };
  state.selectionMaskBounds = { x: outside ? 100 : 4, y: 2, width: 16, height: 8 };
};
const expectExcludedUnchanged = (before: { [K in typeof fields[number]]?: ArrayBuffer }, after: NonNullable<ReturnType<typeof readTestColorCycleBrushLayerSnapshot>>, accepts: (x: number, y: number) => boolean) => {
  let changes = 0;
  for (const field of fields) {
    const oldBytes = new Uint8Array(before[field]!), newBytes = new Uint8Array(after[field]!);
    const bytesPerPixel = field === 'gradientDefIdBuffer' ? 2 : 1;
    for (let i = 0; i < length; i++) for (let byte = 0; byte < bytesPerPixel; byte++) {
      const j = i * bytesPerPixel + byte;
      if (!accepts(i % width, Math.floor(i / width))) expect({ field, i, byte, value: newBytes[j] }).toEqual({ field, i, byte, value: oldBytes[j] });
      else if (newBytes[j] !== oldBytes[j]) changes++;
    }
  }
  return changes;
};

describe('custom Color Cycle selection integration', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCaf = globalThis.cancelAnimationFrame;
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) { return ensureMockContext(this); } as unknown as typeof HTMLCanvasElement.prototype.getContext;
    globalThis.requestAnimationFrame = () => 0;
    globalThis.cancelAnimationFrame = () => {};
  });
  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCaf;
  });
  beforeEach(() => {
    const state = useAppStore.getState() as unknown as TestStore;
    state.layers = [{ id: 'custom', layerType: 'color-cycle', colorCycleData: {} }];
    state.tools.brushSettings = { size: 8 };
    delete state.selectionStart; delete state.selectionEnd; delete state.selectionMask; delete state.selectionMaskBounds;
    delete studioExtension.createColorCycleStrokePaintMask;
  });
  const run = (dither: boolean, captured: boolean, alpha: number, outside = false, unrestricted = false, implicit = false) => {
    if (!unrestricted) setSelection(alpha, outside);
    const brush = new ColorCycleBrushCanvas2D(makeCanvas(width, height), { brushSize: 8, forceCanvas2D: true });
    const before = baseline();
    applyColorCycleBrushLayerSnapshotToRuntime(brush, 'custom', before);
    brush.setStampDitherEnabled(dither);
    brush.setStampDitherBgFill(false);
    if (!implicit) brush.startStroke('custom');
    for (const x of [4, 8, 12, 16, 20]) brush.paintCustomStamp(stamp(captured), x, 6, 'custom', 1);
    brush.endStroke('custom');
    const after = readTestColorCycleBrushLayerSnapshot(brush, 'custom')!;
    const changes = expectExcludedUnchanged(before, after, unrestricted ? () => true : outside ? () => false : selected);
    if (outside) expect(changes).toBe(0); else expect(changes).toBeGreaterThan(0);
    brush.dispose();
    return after;
  };
  it.each([false, true].flatMap(dither => [false, true].map(captured => ({ dither, captured }))))(
    'preserves all six buffers across holes and other-layer selection (dither=$dither captured=$captured)', ({ dither, captured }) => {
      const partial = run(dither, captured, 1);
      const opaque = run(dither, captured, 255);
      for (const field of fields) expect(new Uint8Array(partial[field]!)).toEqual(new Uint8Array(opaque[field]!));
    },
  );
  it.each([false, true])('leaves fully excluded custom stamps unchanged (dither=%s)', dither => { run(dither, false, 80, true); });
  it('preserves unrestricted custom stamp authoring', () => { run(false, false, 255, false, true); });
  it('captures selection for direct custom API calls without explicit startStroke', () => { run(false, true, 80, false, false, true); });
  it('keeps the gesture mask stable and shares it with erase healing', () => {
    setSelection(80);
    const canvas = makeCanvas(width, height);
    const brush = new ColorCycleBrushCanvas2D(canvas, { brushSize: 8, forceCanvas2D: true });
    const before = baseline(); applyColorCycleBrushLayerSnapshotToRuntime(brush, 'custom', before);
    brush.setStampDitherEnabled(false); brush.startStroke('custom');
    // In-place mutation must not alter this gesture's copied membership.
    (useAppStore.getState() as unknown as TestStore).selectionMask!.data.fill(0);
    const tip = stamp(false);
    brush.paintCustomStamp(tip, 12, 6, 'custom', 1);
    const heal = jest.fn();
    const healer = createColorCycleStrokeMaskHealer({ internalCanvas: canvas, layerId: 'custom',
      resolveStampTargetSize: () => 8, healColorCycleEraseMask: heal,
      acceptsPixel: (x, y) => brush.getStrokePaintMask('custom')?.acceptsPixel(x, y) ?? true });
    healer.markPaintedStamp({ x: 12, y: 6, width: 8, height: 4, shape: BrushShape.SQUARE, pressure: 1, rotation: 0, customStamp: tip });
    healer.healPaintedEraseMask();
    expect(heal).toHaveBeenCalledTimes(1);
    const mask = heal.mock.calls[0][1];
    for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
      if (!selected(x + mask.bounds.x, y + mask.bounds.y)) expect(mask.data[y * mask.width + x]).toBe(0);
    }
    brush.endStroke('custom');
    expect(expectExcludedUnchanged(before, readTestColorCycleBrushLayerSnapshot(brush, 'custom')!, selected)).toBeGreaterThan(0);
    const first = readTestColorCycleBrushLayerSnapshot(brush, 'custom')!;
    setSelection(80, true);
    brush.startStroke('custom');
    brush.paintCustomStamp(tip, 12, 6, 'custom', 1);
    brush.endStroke('custom');
    expect(expectExcludedUnchanged(first, readTestColorCycleBrushLayerSnapshot(brush, 'custom')!, () => false)).toBe(0);
    brush.dispose();
  });
  it('prepares the actual custom tip footprint before querying a Studio mask', () => {
    let prepared = false;
    const prepare = jest.fn<void, [Parameters<NonNullable<StudioStrokePaintMask['prepareStamp']>>[0]]>(() => { prepared = true; });
    studioExtension.createColorCycleStrokePaintMask = () => ({ prepareStamp: prepare,
      acceptsPixel: (x) => { expect(prepared).toBe(true); return x < 10; } });
    const brush = new ColorCycleBrushCanvas2D(makeCanvas(width, height), { brushSize: 8, forceCanvas2D: true });
    const before = baseline(); applyColorCycleBrushLayerSnapshotToRuntime(brush, 'custom', before);
    brush.setStampDitherEnabled(false); brush.startStroke('custom');
    brush.paintCustomStamp(stamp(false), 10, 6, 'custom', 1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0][0]).toEqual(expect.objectContaining({ x: 10, y: 6, size: 8,
      footprint: expect.objectContaining({ originX: 6, originY: 4, size: 8 }) }));
    const footprint = prepare.mock.calls[0][0].footprint!;
    expect(Array.from(footprint.data.slice(0, 32))).toEqual(new Array(32).fill(1));
    expect(Array.from(footprint.data.slice(32, 64))).toEqual(new Array(32).fill(0));
    brush.endStroke('custom');
    expect(expectExcludedUnchanged(before, readTestColorCycleBrushLayerSnapshot(brush, 'custom')!, x => x < 10)).toBeGreaterThan(0);
    brush.dispose();
  });
});
