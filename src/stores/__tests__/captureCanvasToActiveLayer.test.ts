jest.mock('@/components/toolbar/BrushControls', () => ({
  __esModule: true,
  default: () => null,
  getColorCycleAnimationState: jest.fn(() => false),
  setColorCycleAnimationHandlers: jest.fn(),
  setColorCycleAnimationState: jest.fn(),
}));

describe('captureCanvasToActiveLayer fallback', () => {
  let useAppStore: typeof import('../useAppStore').useAppStore;

  beforeEach(() => {
    jest.resetModules();

    class TestOffscreenCanvas {
      public width: number;
      public height: number;
      private readonly ctx = {
        clearRect: jest.fn(),
        putImageData: jest.fn(),
        getImageData: jest.fn(() => new ImageData(1, 1)),
      };

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext(): CanvasRenderingContext2D {
        return this.ctx as unknown as CanvasRenderingContext2D;
      }
    }

    (globalThis as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas = TestOffscreenCanvas as unknown as typeof OffscreenCanvas;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ useAppStore } = require('../useAppStore'));
  });

  it('falls back to currentOffscreenCanvas when source canvas is omitted', async () => {
    const storeApi = useAppStore;
    const initialState = storeApi.getState();

    const width = 2;
    const height = 2;

    const capturedPixels = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 255, 255,
      0, 0, 0, 0,
    ]);
    const capturedImageData = new ImageData(capturedPixels, width, height);

    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = width;
    compositeCanvas.height = height;
    const captureCtx = {
      getImageData: jest.fn(() => capturedImageData),
    } as unknown as CanvasRenderingContext2D;
    jest.spyOn(compositeCanvas, 'getContext').mockReturnValue(captureCtx);

    const framebufferCanvas = document.createElement('canvas');
    framebufferCanvas.width = width;
    framebufferCanvas.height = height;
    const framebufferCtx = {
      clearRect: jest.fn(),
      putImageData: jest.fn(),
    } as unknown as CanvasRenderingContext2D;
    jest.spyOn(framebufferCanvas, 'getContext').mockReturnValue(framebufferCtx);

    const baseLayer = initialState.layers[0];
    const layerId = 'layer-test';

    storeApi.setState({
      project: initialState.project
        ? {
            ...initialState.project,
            width,
            height,
          }
        : null,
      layers: [
        {
          ...baseLayer,
          id: layerId,
          imageData: null,
          framebuffer: framebufferCanvas,
        },
      ],
      activeLayerId: layerId,
      currentOffscreenCanvas: compositeCanvas,
    });

    await storeApi.getState().captureCanvasToActiveLayer();

    expect(captureCtx.getImageData).toHaveBeenCalledWith(0, 0, width, height);
    expect(framebufferCtx.clearRect).toHaveBeenCalledWith(0, 0, width, height);
    expect(framebufferCtx.putImageData).toHaveBeenCalledWith(capturedImageData, 0, 0);
    expect(storeApi.getState().layers[0]?.imageData).toBe(capturedImageData);
    expect(storeApi.getState().layersNeedRecomposition).toBe(true);

    storeApi.setState(initialState, true);
  });
});
