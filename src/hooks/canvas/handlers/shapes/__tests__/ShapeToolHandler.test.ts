import { shapeFillBrushPreset, pixelBrushPreset } from '@/presets/brushPresets';
import { __shapeToolTestUtils } from '@/hooks/canvas/handlers/shapes/ShapeToolHandler';
import { shouldUseRenderedCcPreviewFill } from '@/hooks/canvas/handlers/shapes/ccShapePreviewDitherRuntime';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';

describe('ShapeToolHandler – shape fill tool detection', () => {
  const store = useAppStore.getState();

  beforeEach(() => {
    store.setBrushPreset(shapeFillBrushPreset);
    store.setCurrentTool('brush');
  });

  afterEach(() => {
    store.setBrushPreset(pixelBrushPreset);
    store.setCurrentTool('brush');
  });

  it('treats shape fill brush as inactive when the current tool is not brush', () => {
    expect(__shapeToolTestUtils.isShapeFillToolActive()).toBe(true);

    store.setCurrentTool('eraser');

    expect(__shapeToolTestUtils.isShapeFillToolActive()).toBe(false);
  });

  it('masks shape-fill overlay when layer transparency lock is enabled', () => {
    const overlay = document.createElement('canvas');
    overlay.width = 2;
    overlay.height = 1;
    const overlayCtx = overlay.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    overlayCtx.fillStyle = 'rgba(255, 0, 0, 1)';
    overlayCtx.fillRect(0, 0, 2, 1);

    const framebuffer = document.createElement('canvas');
    framebuffer.width = 2;
    framebuffer.height = 1;
    const drawImageSpy = jest.spyOn(overlayCtx, 'drawImage');

    const lockedLayer = {
      transparencyLocked: true,
      imageData: null,
      framebuffer,
    } as Layer;

    __shapeToolTestUtils.applyTransparencyLockMaskToContext(overlayCtx, lockedLayer);

    expect(drawImageSpy).toHaveBeenCalledWith(framebuffer, 0, 0, 2, 1);
    drawImageSpy.mockRestore();
  });

  it('clips preview canvases to the polygon instead of leaving the roi box visible', () => {
    const overlayCtx = {
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      closePath: jest.fn(),
      fill: jest.fn(),
      globalCompositeOperation: 'source-over',
      fillStyle: '#000000',
    } as unknown as CanvasRenderingContext2D;

    __shapeToolTestUtils.applyPolygonMaskToCanvasContext(overlayCtx, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
    ]);

    expect(overlayCtx.save).toHaveBeenCalled();
    expect(overlayCtx.beginPath).toHaveBeenCalled();
    expect(overlayCtx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(overlayCtx.lineTo).toHaveBeenNthCalledWith(1, 4, 0);
    expect(overlayCtx.lineTo).toHaveBeenNthCalledWith(2, 0, 4);
    expect(overlayCtx.closePath).toHaveBeenCalled();
    expect(overlayCtx.fill).toHaveBeenCalled();
    expect(overlayCtx.restore).toHaveBeenCalled();
  });

  it('keeps the last cc preview visible while a replacement job is pending', () => {
    expect(
      __shapeToolTestUtils.shouldKeepCachedCcPreviewVisible({
        hasCachedPreview: true,
        canReplayCurrentPreview: false,
        jobInFlight: true,
      })
    ).toBe(true);
    expect(
      __shapeToolTestUtils.shouldKeepCachedCcPreviewVisible({
        hasCachedPreview: true,
        canReplayCurrentPreview: true,
        jobInFlight: false,
      })
    ).toBe(false);
    expect(
      __shapeToolTestUtils.shouldKeepCachedCcPreviewVisible({
        hasCachedPreview: false,
        canReplayCurrentPreview: false,
        jobInFlight: true,
      })
    ).toBe(false);
  });

  it('keeps CC dither preview settings aligned with finalize settings', () => {
    expect(
      __shapeToolTestUtils.resolveCcShapePreviewRenderSettings({
        pixelSize: 1,
        levels: 12,
        algorithm: 'sierra-lite',
        patternStyle: undefined,
      })
    ).toEqual({
      pixelSize: 1,
      levels: 12,
      algorithm: 'sierra-lite',
      patternStyle: 'dots',
      isFastPreview: false,
    });

    expect(
      __shapeToolTestUtils.resolveCcShapePreviewRenderSettings({
        pixelSize: 3,
        levels: 6,
        algorithm: 'bayer',
        patternStyle: 'crosshatch',
      })
    ).toEqual({
      pixelSize: 3,
      levels: 6,
      algorithm: 'bayer',
      patternStyle: 'crosshatch',
      isFastPreview: false,
    });
  });

  it('uses concentric edge-distance sampling for cc shape previews in concentric mode', () => {
    const sampleNormalized = __shapeToolTestUtils.createCcShapePreviewSampleNormalized({
      colorCycleFillMode: 'concentric',
      localVertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      width: 10,
      height: 10,
    });

    const leftEdge = sampleNormalized(0.5, 5);
    const topEdge = sampleNormalized(5, 0.5);
    const center = sampleNormalized(5, 5);

    expect(leftEdge).toBeCloseTo(topEdge, 6);
    expect(leftEdge).toBeGreaterThanOrEqual(0);
    expect(center).toBeLessThanOrEqual(1);
    expect(center).toBeGreaterThan(leftEdge);
  });

  it('builds a stable preview gradient cache key and prepares normalized preview stops', () => {
    const effectiveStops = [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ];

    const keyA = __shapeToolTestUtils.buildCcShapePreviewGradientCacheKey({
      effectiveStops,
      gradientBands: 8,
      ditherPaletteSpread: 24,
      ditherAlgorithm: 'sierra-lite',
      patternStyle: 'dots',
      useForegroundDerived: false,
      foregroundDerivedKey: 'none',
      previewSource: 'manual',
    });
    const keyB = __shapeToolTestUtils.buildCcShapePreviewGradientCacheKey({
      effectiveStops,
      gradientBands: 8,
      ditherPaletteSpread: 24,
      ditherAlgorithm: 'sierra-lite',
      patternStyle: 'dots',
      useForegroundDerived: false,
      foregroundDerivedKey: 'none',
      previewSource: 'manual',
    });
    const keyC = __shapeToolTestUtils.buildCcShapePreviewGradientCacheKey({
      effectiveStops,
      gradientBands: 12,
      ditherPaletteSpread: 24,
      ditherAlgorithm: 'sierra-lite',
      patternStyle: 'dots',
      useForegroundDerived: false,
      foregroundDerivedKey: 'none',
      previewSource: 'manual',
    });

    expect(keyA).toBe(keyB);
    expect(keyA).not.toBe(keyC);

    const prepared = __shapeToolTestUtils.prepareCcShapePreviewGradient({
      effectiveStops,
      shouldDitherPreview: false,
      gradientBands: 8,
      ditherPaletteSpread: 0,
      ditherAlgorithm: 'sierra-lite',
      preserveSourceStops: false,
    });

    expect(prepared.renderStops).toEqual(effectiveStops);
    expect(prepared.sortedStops).toEqual([
      { position: 0, rgba: [0, 0, 0, 255] },
      { position: 1, rgba: [255, 255, 255, 255] },
    ]);
  });

  it('includes the live preview point in the fill polygon while keeping the extension separate', () => {
    const previewPaths = __shapeToolTestUtils.buildPolygonPreviewPaths(
      [
        { x: 10, y: 10 },
        { x: 40, y: 10 },
        { x: 40, y: 40 },
      ],
      { x: 15, y: 55 }
    );

    expect(previewPaths.fillPolygon).toEqual([
      { x: 10, y: 10 },
      { x: 40, y: 10 },
      { x: 40, y: 40 },
      { x: 15, y: 55 },
    ]);
    expect(previewPaths.closedPolygon).toEqual([
      { x: 10, y: 10 },
      { x: 40, y: 10 },
      { x: 40, y: 40 },
    ]);
    expect(previewPaths.extensionSegment).toEqual([
      { x: 40, y: 40 },
      { x: 15, y: 55 },
    ]);
    expect(previewPaths.anchorPoints).toEqual(previewPaths.fillPolygon);
  });

  it('replays cached cc dither preview only when the roi still matches', () => {
    const roi = __shapeToolTestUtils.computeCcPreviewRoi([
      { x: 10.2, y: 20.1 },
      { x: 18.8, y: 22.4 },
      { x: 14.6, y: 31.9 },
    ]);

    expect(
      __shapeToolTestUtils.canReplayCcPreview(
        roi.origin,
        roi.size,
        roi,
      )
    ).toBe(true);

    expect(
      __shapeToolTestUtils.canReplayCcPreview(
        { x: roi.origin.x, y: roi.origin.y - 1 },
        roi.size,
        roi,
      )
    ).toBe(false);

    expect(
      __shapeToolTestUtils.canReplayCcPreview(
        roi.origin,
        { width: roi.size.width - 1, height: roi.size.height },
        roi,
      )
    ).toBe(false);

    expect(
      __shapeToolTestUtils.canReplayCcPreview(
        roi.origin,
        roi.size,
        'preview-a',
        roi,
        'preview-a',
      )
    ).toBe(true);

    expect(
      __shapeToolTestUtils.canReplayCcPreview(
        roi.origin,
        roi.size,
        'preview-a',
        roi,
        'preview-b',
      )
    ).toBe(false);
  });

  it('keeps the preview closure anchored to the first committed point', () => {
    const previewPaths = __shapeToolTestUtils.buildPolygonPreviewPaths(
      [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 30 },
      ],
      { x: 45, y: 22 },
    );

    expect(previewPaths.closedPolygon).toEqual([
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
    ]);
    expect(previewPaths.extensionSegment).toEqual([
      { x: 30, y: 30 },
      { x: 45, y: 22 },
    ]);
    expect(previewPaths.anchorPoints).toEqual([
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
      { x: 45, y: 22 },
    ]);
  });

  it('keeps using the last rendered cc preview fill until a new frame is ready', () => {
    expect(
      shouldUseRenderedCcPreviewFill({
        canReplayCurrentPreview: false,
        shouldDrawCachedPreview: false,
      })
    ).toBe(false);

    expect(
      shouldUseRenderedCcPreviewFill({
        canReplayCurrentPreview: false,
        shouldDrawCachedPreview: true,
      })
    ).toBe(true);

    expect(
      shouldUseRenderedCcPreviewFill({
        canReplayCurrentPreview: true,
        shouldDrawCachedPreview: true,
      })
    ).toBe(true);
  });
});
