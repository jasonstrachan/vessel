import { renderHook } from '@testing-library/react';

import { useDrawingCanvasBaseRenderer } from '@/components/canvas/useDrawingCanvasBaseRenderer';
import { setOverlaySeededFromLayer } from '@/hooks/canvas/utils/overlaySeedState';
import { BrushShape, type Layer, type Project } from '@/types';

const mockGetState = jest.fn();

jest.mock('@/stores/appStoreAccess', () => ({
  getAppStoreState: () => mockGetState(),
}));
jest.mock('@/components/canvas/drawingCanvasSelection', () => ({
  drawSelectionLayer: jest.fn(),
}));

const createCanvas = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  return canvas;
};

describe('eraser layer presentation', () => {
  const rasterGlobals = globalThis as typeof globalThis & {
    __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean;
  };
  beforeEach(() => { rasterGlobals.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true; });
  afterEach(() => { delete rasterGlobals.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__; });

  it.each([
    ['normal', false], ['sequential', false], ['normal', true], ['sequential', true],
  ] as const)(
    'shows the remaining %s layer in stack order (upper layer: %s) throughout pen-down and pen-up',
    (layerType, hasUpperLayer) => {
      const framebuffer = createCanvas();
      const layer = {
        id: 'active', visible: true, opacity: 1, blendMode: 'source-over',
        order: 0, layerType, framebuffer,
      } as Layer;
      const project = { id: 'erase-test', width: 16, height: 16 } as Project;
      const upperCanvas = createCanvas();
      const upperCtx = upperCanvas.getContext('2d')!;
      upperCtx.fillStyle = '#00ff00';
      upperCtx.fillRect(0, 0, 16, 16);
      const layers = hasUpperLayer
        ? [layer, { ...layer, id: 'upper', order: 1, layerType: 'normal' as const, framebuffer: upperCanvas }]
        : [layer];
      const overlay = createCanvas();
      const overlayCtx = overlay.getContext('2d')!;
      overlayCtx.fillStyle = '#ff3300';
      overlayCtx.fillRect(0, 0, 16, 16);
      overlayCtx.clearRect(8, 0, 4, 16);
      setOverlaySeededFromLayer(overlay, true);
      const runtime = {
        project, layers, layerGroups: [], activeLayerId: layer.id,
        sequentialRecord: { isPointerDown: true },
        colorCyclePlayback: { desiredPlaying: false },
      };
      mockGetState.mockImplementation(() => runtime);
      const { result } = renderHook(() => useDrawingCanvasBaseRenderer({
        project, layers, activeLayerId: layer.id,
        activeCanvasShape: null, canvasShapeEditor: { active: false, draft: null },
        checkerPatternCanvasRef: { current: null },
        checkerPatternCacheRef: { current: new WeakMap() },
        brushShape: BrushShape.SQUARE, antialiasing: false, displayMode: 'pixelated',
        displayFilters: [], transparencyBackgroundMode: 'gray', frameColor: '#000000',
        currentTool: 'eraser', underCompositeCanvasRef: { current: null },
        underCompositeHasContentRef: { current: false },
        compositeCanvasDirtyRef: { current: false }, renderSplitComposites: jest.fn(),
        drawNonActiveVisibleLayers: jest.fn(), compositeSegmentsRef: { current: [] },
        layerMapRef: { current: new Map(layers.map((item) => [item.id, item])) }, compositeBitmap: null,
        compositeCanvasRef: { current: null }, overCompositeHasContentRef: { current: false },
        overCompositeCanvasRef: { current: null }, colorCycleManagerRef: { current: null },
        floatingPaste: null, marchingAntsOffset: 0, pasteCanvasRef: { current: null },
        lastPasteInfoRef: { current: { imageData: null, width: 0, height: 0 } },
        selectionStart: { x: 8, y: 0 }, selectionEnd: { x: 12, y: 16 }, selectionMask: null,
        selectionMaskBounds: null, selectionVectorPath: null,
      }));
      const ctx = createCanvas().getContext('2d')!;
      const draw = (isDrawing: boolean) => result.current(
        ctx, { scale: 1, offsetX: 0, offsetY: 0 }, false, overlay, isDrawing, true,
      );

      draw(true);
      const expected = hasUpperLayer ? [0, 255, 0, 255] : [255, 51, 0, 255];
      expect(Array.from(ctx.getImageData(2, 2, 1, 1).data)).toEqual(expected);
      runtime.sequentialRecord.isPointerDown = false;
      draw(false);
      expect(Array.from(ctx.getImageData(2, 2, 1, 1).data)).toEqual(expected);
    },
  );
});
