import { ColorCycleCustomStampCache, type CustomStampInput } from '../colorCycleCustomStampCache';
import {
  ColorCycleCustomStampRuntime,
  type ColorCycleCustomStampRuntimeDeps,
} from '../colorCycleCustomStampRuntime';
import { createLayerStrokeState } from '../colorCycleLayerStrokeBuffers';

const createStamp = (cacheKey = 'stamp-a'): CustomStampInput => {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create stamp context');
  }
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 2, 2);
  return {
    imageData: ctx.getImageData(0, 0, 2, 2),
    width: 2,
    height: 2,
    cacheKey,
  };
};

describe('ColorCycleCustomStampCache', () => {
  it('reuses scaled stamp canvases through a versioned cache service', () => {
    const cache = new ColorCycleCustomStampCache();
    const stamp = createStamp();

    const first = cache.getScaledStampCanvas(stamp, 8, 8);
    const second = cache.getScaledStampCanvas(stamp, 8, 8);

    expect(second).toBe(first);
    expect(cache.scaledSize).toBe(1);
    expect(cache.version).toBe(0);
  });

  it('reuses stamp masks and tracks mask cache size', () => {
    const cache = new ColorCycleCustomStampCache();
    const stamp = createStamp();
    const scaled = cache.getScaledStampCanvas(stamp, 8, 8);

    const first = cache.getStampMask(stamp, scaled, 8, 8, 10, 10, Math.PI / 4);
    const second = cache.getStampMask(stamp, scaled, 8, 8, 10, 10, Math.PI / 4);

    expect(second).toBe(first);
    expect(cache.maskSize).toBe(1);
  });

  it('clears derived caches and advances the service-local cache version', () => {
    const cache = new ColorCycleCustomStampCache();
    const stamp = createStamp();
    const scaled = cache.getScaledStampCanvas(stamp, 8, 8);
    cache.getStampMask(stamp, scaled, 8, 8, 10, 10, Math.PI / 4);

    cache.clear();

    expect(cache.version).toBe(1);
    expect(cache.scaledSize).toBe(0);
    expect(cache.maskSize).toBe(0);
  });
});

describe('ColorCycleCustomStampRuntime', () => {
  it('tracks the document version consumed by custom stamp painting', () => {
    const runtime = new ColorCycleCustomStampRuntime();
    const strokeData = createLayerStrokeState({
      bufferSize: 16,
      strokeCycleSpeed: 1,
      strokeSpeedByte: 1,
    });
    const animator = {
      setStrokeSpeedByte: jest.fn(),
      setFlowMode: jest.fn(),
      setIndex: jest.fn(),
    };
    const deps: ColorCycleCustomStampRuntimeDeps = {
      width: 4,
      height: 4,
      getActiveLayerId: () => 'layer-a',
      getLayerDocumentVersion: () => 42,
      prepareStrokeContext: () => ({
        id: 'layer-a',
        animator: animator as never,
        strokeData,
      }),
      applyStrokeFlowSpeed: jest.fn(),
      isStampDitherEnabled: () => false,
      getWriteSpeedByte: () => 1,
      getFlowMode: () => 'forward',
      resolvePressureBrushSize: () => 2,
      advanceStrokePhase: jest.fn(),
      computeColorBandIndexPerStamp: () => 3,
      getNonDitherStrokeColorIndex: () => 7,
      resolveCapturedStampGradientBinding: () => null,
      resolveActiveStrokeSlot: () => 1,
      resolveFlowSlot: () => 1,
      resolveGradientDefIdForSlot: () => null,
      logSetIndexSample: jest.fn(),
      markStrokeStateContentWritten: (nextStrokeData) => {
        nextStrokeData.hasContent = true;
      },
      getLayerGradientDefs: () => undefined,
      applyDefBindingsForLayer: jest.fn(),
      markPresenterLayerDirty: jest.fn(),
      scheduleDirtyRender: jest.fn(),
    };

    expect(runtime.builtFromVersion).toBeNull();

    runtime.paint(createStamp(), 2, 2, deps);

    expect(runtime.builtFromVersion).toBe(42);

    runtime.clear();

    expect(runtime.builtFromVersion).toBeNull();
  });
});
