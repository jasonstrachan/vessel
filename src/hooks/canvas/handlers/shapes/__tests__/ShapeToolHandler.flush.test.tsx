/* eslint-disable @typescript-eslint/no-explicit-any */
import { createShapeToolHandler } from '../ShapeToolHandler';

describe('ShapeToolHandler finalize/preview flow', () => {
  it('exposes pointer handler API and no public flush hook', () => {
    const handler = createShapeToolHandler(
      {
        deps: {
          canvasRef: { current: document.createElement('canvas') },
          canvas: { zoom: 1 },
          pan: {
            screenToWorld: (x: number, y: number) => ({ x, y }),
            worldToScreen: (x: number, y: number) => ({ x, y }),
          },
          drawingHandlers: {},
          tools: {
            currentTool: 'brush',
            brushSettings: { brushShape: 'round', pressureEnabled: false, color: '#000000' },
            fillSettings: { threshold: 0, contiguous: true, eraseInstead: false },
            eraserSettings: {},
            shapeMode: false,
            customBrushCapture: { mode: 'idle', sourceLayerId: null, points: [], freehandPath: null },
          },
          overlayCanvasRef: { current: null },
          compositeCanvasRef: { current: null },
          compositeCanvasDirtyRef: { current: false },
          compositeLayersToCanvas: jest.fn(),
          setCurrentOffscreenCanvas: jest.fn(),
          project: { width: 100, height: 100 },
          stateMachine: { dispatch: jest.fn(), finalizationComplete: jest.fn(), state: { mode: 'IDLE' } },
          setNeedsRedraw: jest.fn(),
          viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
          sampleColorAtPosition: jest.fn(() => '#000000'),
          previewAnimationFrameRef: { current: null },
          layers: [],
          activeLayerId: null,
          interaction: { dispatch: jest.fn() },
          feedback: jest.fn(),
        } as any,
        overlayPreviewFrameMs: 16,
        getLastOverlayPreviewTs: () => 0,
        setLastOverlayPreviewTs: jest.fn(),
      },
      {}
    ) as any;

    expect(typeof handler.handlePointerDown).toBe('function');
    expect(typeof handler.handlePointerMove).toBe('function');
    expect(typeof handler.handlePointerUp).toBe('function');
    expect(handler.flush).toBeUndefined();
  });
});
