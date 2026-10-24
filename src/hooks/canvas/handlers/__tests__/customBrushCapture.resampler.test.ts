import {
  captureResamplerSingleSample,
  updateContinuousResamplerSample,
  type CaptureBrushFromCanvas,
} from '@/hooks/canvas/handlers/customBrushCapture';
import { CustomPatternCache, drawCustomPatternShape } from '@/hooks/brushEngine/shapeCustomPattern';
import { captureBrushFromCanvas } from '@/utils/customBrushCapture';

type Sample = NonNullable<ReturnType<typeof captureResamplerSingleSample>>;
type CacheableImage = ImageData & { __vesselCacheKey?: string };

const requireSample = (sample: Sample | undefined): Sample => {
  if (!sample) throw new Error('Expected a real positive source capture');
  return sample;
};

const fixture = () => {
  const source = document.createElement('canvas');
  source.width = 64;
  source.height = 32;
  const sourceCtx = source.getContext('2d')!;
  sourceCtx.fillStyle = '#ff0000';
  sourceCtx.fillRect(0, 0, 32, 32);
  sourceCtx.fillStyle = '#0000ff';
  sourceCtx.fillRect(32, 0, 32, 32);
  const target = document.createElement('canvas');
  target.width = 64;
  target.height = 32;
  const ctx = target.getContext('2d')!;
  const cache = new CustomPatternCache();
  const ref: { current: Sample | undefined } = { current: undefined };
  const stampCounterRef = { current: 0 };
  const capture = (mode: 'single' | 'continuous', x: number, interval = 1, io: CaptureBrushFromCanvas = captureBrushFromCanvas) => {
    const args = {
      samplePos: { x, y: 16 }, brushSize: 8, compositeCanvas: source,
      resamplerBrushDataRef: ref,
    };
    return mode === 'single'
      ? captureResamplerSingleSample(args, { captureBrushFromCanvas: io })
      : updateContinuousResamplerSample({ ...args, stampCounterRef, resampleInterval: interval }, { captureBrushFromCanvas: io });
  };
  const render = (sample: Sample, x: number) => drawCustomPatternShape({
    targetCtx: ctx, drawX: x, drawY: 16, size: 8, pattern: sample.imageData,
    rotation: 0, cache,
  });
  const pixel = (x: number) => [...ctx.getImageData(x, 16, 1, 1).data];
  return { source, ctx, ref, cache, capture, render, pixel, stampCounterRef };
};

describe('Resampler capture identity and shared pattern rendering', () => {
  const rasterWindow = globalThis as typeof globalThis & { __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean };
  beforeEach(() => { rasterWindow.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true; });
  afterEach(() => { delete rasterWindow.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__; });

  it.each(['single', 'continuous'] as const)('renders fresh %s red then blue captures through the same pattern caches', (mode) => {
    const f = fixture();
    const red = requireSample(f.capture(mode, 16));
    f.render(red, 16);
    expect(f.pixel(16)).toEqual([255, 0, 0, 255]);
    const blue = requireSample(f.capture(mode, 48));
    expect([...blue.imageData.data.slice(0, 4)]).toEqual([0, 0, 255, 255]);
    f.render(blue, 48);

    expect(f.pixel(48)).toEqual([0, 0, 255, 255]);
    expect(f.pixel(16)).toEqual([255, 0, 0, 255]);
    expect(blue.cacheKey).not.toBe(red.cacheKey);
    expect((blue.imageData as CacheableImage).__vesselCacheKey).toBe(blue.cacheKey);
    expect((red.imageData as CacheableImage).__vesselCacheKey).toBe(red.cacheKey);
    expect(f.cache.sourceSize).toBe(2);
    expect(f.cache.scaledSize).toBe(2);
  });

  it('retains the current sample/key between interval captures and refreshes on the processed threshold', () => {
    const f = fixture();
    const capture = jest.fn(captureBrushFromCanvas);
    const red = requireSample(f.capture('continuous', 16, 3, capture));
    f.render(red, 16);
    expect(f.stampCounterRef.current).toBe(0);
    expect(f.capture('continuous', 48, 3, capture)).toBe(red);
    expect(f.capture('continuous', 48, 3, capture)).toBe(red);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(f.ref.current?.cacheKey).toBe(red.cacheKey);
    f.render(requireSample(f.ref.current), 32);
    expect(f.pixel(32)).toEqual([255, 0, 0, 255]);

    const blue = requireSample(f.capture('continuous', 48, 3, capture));
    expect(capture).toHaveBeenCalledTimes(2);
    expect(f.stampCounterRef.current).toBe(0);
    expect([...blue.imageData.data.slice(0, 4)]).toEqual([0, 0, 255, 255]);
    f.render(blue, 48);
    expect(f.pixel(48)).toEqual([0, 0, 255, 255]);
    expect(blue.cacheKey).not.toBe(red.cacheKey);
  });

  it('assigns distinct successful-capture identities even for equal pixel content', () => {
    const f = fixture();
    const first = requireSample(f.capture('single', 16));
    const second = requireSample(f.capture('single', 16));

    expect(second.imageData.data).toEqual(first.imageData.data);
    expect(second.cacheKey).not.toBe(first.cacheKey);
    expect((first.imageData as CacheableImage).__vesselCacheKey).toBe(first.cacheKey);
    expect((second.imageData as CacheableImage).__vesselCacheKey).toBe(second.cacheKey);
  });

  it('reuses one retained sample identity through repeated material rendering', () => {
    const f = fixture();
    const sample = requireSample(f.capture('single', 16));
    const key = sample.cacheKey;
    f.render(sample, 16);
    f.render(sample, 32);
    f.render(sample, 48);

    expect(f.ref.current).toBe(sample);
    expect(sample.cacheKey).toBe(key);
    expect((sample.imageData as CacheableImage).__vesselCacheKey).toBe(key);
    expect(f.cache.sourceSize).toBe(1);
    expect(f.cache.scaledSize).toBe(1);
    expect([f.pixel(16), f.pixel(32), f.pixel(48)]).toEqual([
      [255, 0, 0, 255], [255, 0, 0, 255], [255, 0, 0, 255],
    ]);
  });

  it.each(['single', 'continuous'] as const)('retains the %s sample and both key aliases when capture I/O fails', (mode) => {
    const f = fixture();
    const sample = requireSample(f.capture(mode, 16));
    const key = sample.cacheKey;
    const failedCapture = jest.fn(() => null);

    expect(f.capture(mode, 48, 1, failedCapture)).toBe(sample);
    expect(failedCapture).toHaveBeenCalledTimes(1);
    expect(f.ref.current).toBe(sample);
    expect(sample.cacheKey).toBe(key);
    expect((sample.imageData as CacheableImage).__vesselCacheKey).toBe(key);
    f.render(sample, 48);
    expect(f.pixel(48)).toEqual([255, 0, 0, 255]);
  });

  it('retains capture identity without invoking I/O for missing source, empty size or out-of-bounds clamped capture', () => {
    const f = fixture();
    const sample = requireSample(f.capture('single', 16));
    const key = sample.cacheKey;
    const capture = jest.fn(captureBrushFromCanvas);
    const base = { samplePos: { x: 16, y: 16 }, brushSize: 8, compositeCanvas: f.source, resamplerBrushDataRef: f.ref };

    expect(captureResamplerSingleSample({ ...base, compositeCanvas: null }, { captureBrushFromCanvas: capture })).toBe(sample);
    expect(captureResamplerSingleSample({ ...base, brushSize: 0 }, { captureBrushFromCanvas: capture })).toBe(sample);
    expect(updateContinuousResamplerSample({
      ...base, samplePos: { x: 100, y: 100 }, stampCounterRef: f.stampCounterRef, resampleInterval: 1,
    }, { captureBrushFromCanvas: capture })).toBe(sample);
    expect(capture).not.toHaveBeenCalled();
    expect(f.ref.current?.cacheKey).toBe(key);
    expect((sample.imageData as CacheableImage).__vesselCacheKey).toBe(key);
  });

  it('leaves absent retained state undefined on capture failure', () => {
    const f = fixture();
    expect(f.capture('continuous', 16, 1, () => null)).toBeUndefined();
    expect(f.ref.current).toBeUndefined();
    expect(f.cache.sourceSize).toBe(0);
  });
});
