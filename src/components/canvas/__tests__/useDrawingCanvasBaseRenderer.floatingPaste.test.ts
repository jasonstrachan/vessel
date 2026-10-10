import { renderHook } from '@testing-library/react';

import * as floatingPasteRenderer from '@/components/canvas/drawingCanvasFloatingPaste';
import { useDrawingCanvasBaseRenderer } from '@/components/canvas/useDrawingCanvasBaseRenderer';
import { BrushShape, type Layer, type Project } from '@/types';

const mockGetState = jest.fn();
jest.mock('@/stores/appStoreAccess', () => ({ getAppStoreState: () => mockGetState() }));
jest.mock('@/components/canvas/drawingCanvasSelection', () => ({ drawSelectionLayer: jest.fn() }));
jest.mock('@/utils/marqueeStroke', () => ({ strokeMarqueeRect: jest.fn(), strokeMarqueePath: jest.fn() }));

const createCanvas = (color?: string) => {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  if (color) {
    const context = canvas.getContext('2d')!;
    context.fillStyle = color;
    context.fillRect(0, 0, 16, 16);
  }
  return canvas;
};

// The shared shim copies RGBA but does not blend or restore Canvas2D state.
// Observe actual replacement pixels and composition inputs here; native preview
// checks own final blended pixels, masks, shape clipping, and adjustment output.
describe('indexed floating paste layer integration', () => {
  const rasterGlobals = globalThis as typeof globalThis & {
    __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean;
  };
  beforeEach(() => { rasterGlobals.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true; });
  afterEach(() => {
    delete rasterGlobals.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
    jest.restoreAllMocks();
  });

  it.each([false, true])('replaces the active layer once, preserving stack inputs (adjustment: %s)', (adjustment) => {
    const activeCanvas = createCanvas('#ff0000');
    const layer = {
      id: 'active', visible: true, opacity: 0.5, blendMode: 'source-over', order: 1,
      layerType: 'color-cycle', framebuffer: activeCanvas,
      colorCycleData: { canvas: activeCanvas, runtimeHydrationState: 'active' },
    } as Layer;
    const lower = { ...layer, id: 'lower', order: 0, layerType: 'normal', opacity: 1, framebuffer: createCanvas('#0000ff') } as Layer;
    const upper = { ...layer, id: 'upper', order: 2, layerType: 'normal', opacity: 0.25, framebuffer: createCanvas('#00ff00') } as Layer;
    const layers = [lower, layer, upper];
    if (adjustment) layers.push({
      ...lower, id: 'adjustment', order: 3, layerType: 'adjustment',
      adjustmentData: { effect: { id: 'hue-sat', settings: {
        hue: 0, saturation: 0, vibrance: 0, lightness: 0, contrast: 0,
        red: 0, green: 0, blue: 0, hueRangeEnabled: false, hueRangeStart: 0, hueRangeEnd: 360,
      } } },
    });
    const project = { id: 'float-test', width: 16, height: 16 } as Project;
    mockGetState.mockReturnValue({
      project, layers, layerGroups: [], activeLayerId: layer.id,
      sequentialRecord: { isPointerDown: false }, colorCyclePlayback: { desiredPlaying: false },
    });
    const imageData = new ImageData(2, 1);
    imageData.data.set([0, 255, 0, 128], 4);
    const floatingPaste = {
      imageData, position: { x: 6, y: 6 }, width: 2, height: 1,
      colorCycleIndices: new Uint8Array([163, 100]),
      colorCycleSelectionMasks: { membership: new Uint8Array([255, 255]), eraseAlpha: new Uint8Array([255, 127]), softEdgeAlpha: null },
    };
    const renderSplitComposites = jest.fn();
    const overlay = jest.spyOn(floatingPasteRenderer, 'renderFloatingPasteLayerOverlay');
    const splitUpper = createCanvas('#ffff00');
    const { result } = renderHook(() => useDrawingCanvasBaseRenderer({
      project, layers, activeLayerId: layer.id,
      activeCanvasShape: null, canvasShapeEditor: { active: false, draft: null },
      checkerPatternCanvasRef: { current: null }, checkerPatternCacheRef: { current: new WeakMap() },
      brushShape: BrushShape.SQUARE, antialiasing: false, displayMode: 'pixelated',
      displayFilters: [], transparencyBackgroundMode: 'gray', frameColor: '#000000', currentTool: 'selection',
      underCompositeCanvasRef: { current: createCanvas() }, underCompositeHasContentRef: { current: true },
      compositeCanvasDirtyRef: { current: false }, renderSplitComposites,
      drawNonActiveVisibleLayers: jest.fn(), compositeSegmentsRef: { current: [] },
      layerMapRef: { current: new Map(layers.map((item) => [item.id, item])) }, compositeBitmap: null,
      compositeCanvasRef: { current: null }, overCompositeHasContentRef: { current: true },
      overCompositeCanvasRef: { current: splitUpper }, colorCycleManagerRef: { current: null },
      floatingPaste, marchingAntsOffset: 0, pasteCanvasRef: { current: null },
      lastPasteInfoRef: { current: { imageData: null, width: 0, height: 0 } },
      selectionStart: null, selectionEnd: null, selectionMask: null, selectionMaskBounds: null, selectionVectorPath: null,
    }));
    const draws: Array<{ source: CanvasImageSource; target: HTMLCanvasElement; alpha: number; blend: string }> = [];
    const originalDraw = CanvasRenderingContext2D.prototype.drawImage;
    jest.spyOn(CanvasRenderingContext2D.prototype, 'drawImage').mockImplementation(function (
      this: CanvasRenderingContext2D, ...args: Parameters<CanvasRenderingContext2D['drawImage']>
    ) {
      draws.push({ source: args[0], target: this.canvas, alpha: this.globalAlpha, blend: this.globalCompositeOperation });
      originalDraw.apply(this, args);
    });
    result.current(createCanvas().getContext('2d')!, { scale: 1, offsetX: 0, offsetY: 0 }, false, null, false, false);

    expect(overlay).toHaveBeenCalledTimes(1);
    expect(overlay).toHaveBeenCalledWith(expect.objectContaining({ baseColorCycleCanvas: activeCanvas }));
    const replacement = overlay.mock.results[0].value as HTMLCanvasElement;
    const replacementContext = replacement.getContext('2d')!;
    expect(Array.from(replacementContext.getImageData(2, 2, 1, 1).data)).toEqual([255, 0, 0, 255]);
    expect(Array.from(replacementContext.getImageData(6, 6, 2, 1).data)).toEqual([0, 0, 0, 0, 0, 255, 0, 128]);
    expect(Array.from(activeCanvas.getContext('2d')!.getImageData(6, 6, 1, 1).data)).toEqual([255, 0, 0, 255]);
    expect(draws.filter((draw) => draw.source === replacement)).toEqual([
      expect.objectContaining({ alpha: 0.5, blend: 'source-over' }),
    ]);
    expect(draws.filter((draw) => draw.source === lower.framebuffer)).toHaveLength(1);
    expect(draws.filter((draw) => draw.source === upper.framebuffer)).toEqual([
      expect.objectContaining({ alpha: 0.25 }),
    ]);
    expect(draws.filter((draw) => draw.source === activeCanvas)).toEqual([
      expect.objectContaining({ target: replacement, alpha: 1 }),
    ]);
    expect(draws.some((draw) => draw.source === splitUpper)).toBe(false);
    expect(renderSplitComposites).not.toHaveBeenCalled();
  });
});
