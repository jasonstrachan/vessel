import { shapeFillBrushPreset, pixelBrushPreset } from '@/presets/brushPresets';
import { __shapeToolTestUtils } from '@/hooks/canvas/handlers/shapes/ShapeToolHandler';
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

  it('uses a cheaper fast-preview render configuration for live CC dither previews', () => {
    expect(
      __shapeToolTestUtils.resolveCcShapePreviewRenderSettings({
        pixelSize: 1,
        levels: 12,
        algorithm: 'sierra-lite',
        patternStyle: undefined,
      })
    ).toEqual({
      pixelSize: 2,
      levels: 4,
      algorithm: 'pattern',
      patternStyle: 'dots',
      isFastPreview: true,
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
      levels: 4,
      algorithm: 'bayer',
      patternStyle: 'crosshatch',
      isFastPreview: true,
    });
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
});
