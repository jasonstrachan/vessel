import { clearColorCycleShapeEraseMask } from '@/hooks/canvas/handlers/colorCycle/colorCycleShapeFill';
import { useAppStore } from '@/stores/useAppStore';

describe('colorCycleShapeFill erase mask healing', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const getAlpha = (canvas: HTMLCanvasElement, x: number, y: number): number => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Missing canvas context');
    }
    return ctx.getImageData(x, y, 1, 1).data[3];
  };

  it('clears only finalized shape alpha from the erase mask', () => {
    const eraseMask = document.createElement('canvas');
    eraseMask.width = 32;
    eraseMask.height = 32;
    const eraseMaskCtx = eraseMask.getContext('2d', { willReadFrequently: true });
    if (!eraseMaskCtx) {
      throw new Error('Missing erase mask context');
    }
    eraseMaskCtx.fillStyle = 'rgba(0, 0, 0, 1)';
    eraseMaskCtx.fillRect(0, 0, eraseMask.width, eraseMask.height);

    const shapeOverlay = document.createElement('canvas');
    shapeOverlay.width = 32;
    shapeOverlay.height = 32;
    const shapeOverlayCtx = shapeOverlay.getContext('2d', { willReadFrequently: true });
    if (!shapeOverlayCtx) {
      throw new Error('Missing shape overlay context');
    }
    shapeOverlayCtx.fillStyle = 'rgba(255, 0, 0, 1)';
    shapeOverlayCtx.fillRect(7, 9, 1, 1);

    const updateLayer = jest.fn();

    const layerId = 'layer-cc';
    const state = {
      layers: [
        {
          id: layerId,
          transparencyLocked: false,
          colorCycleData: {
            eraseMask,
            eraseMaskVersion: 2,
          },
        },
      ],
      updateLayer,
      setCcGradientSampleCount: jest.fn(),
    };
    jest.spyOn(useAppStore, 'getState').mockReturnValue(
      state as unknown as ReturnType<typeof useAppStore.getState>
    );

    clearColorCycleShapeEraseMask(layerId, { x: 5, y: 6, width: 7, height: 8 }, shapeOverlay);

    expect(getAlpha(eraseMask, 7, 9)).toBe(0);
    expect(getAlpha(eraseMask, 5, 6)).toBe(255);
    expect(getAlpha(eraseMask, 11, 12)).toBe(255);
    expect(updateLayer).toHaveBeenCalledWith(
      layerId,
      { colorCycleData: { eraseMaskVersion: 3 } },
      { skipColorCycleSync: true }
    );
  });

  it('clears finalized shape pixels from a paint mask when the overlay is empty', () => {
    const eraseMask = document.createElement('canvas');
    eraseMask.width = 32;
    eraseMask.height = 32;
    const eraseMaskCtx = eraseMask.getContext('2d', { willReadFrequently: true });
    if (!eraseMaskCtx) {
      throw new Error('Missing erase mask context');
    }
    eraseMaskCtx.fillStyle = 'rgba(0, 0, 0, 1)';
    eraseMaskCtx.fillRect(0, 0, eraseMask.width, eraseMask.height);

    const emptyOverlay = document.createElement('canvas');
    emptyOverlay.width = 32;
    emptyOverlay.height = 32;

    const updateLayer = jest.fn();
    const layerId = 'layer-cc';
    const state = {
      layers: [
        {
          id: layerId,
          transparencyLocked: false,
          colorCycleData: {
            eraseMask,
            eraseMaskVersion: 2,
          },
        },
      ],
      updateLayer,
      setCcGradientSampleCount: jest.fn(),
    };
    jest.spyOn(useAppStore, 'getState').mockReturnValue(
      state as unknown as ReturnType<typeof useAppStore.getState>
    );

    clearColorCycleShapeEraseMask(
      layerId,
      { x: 5, y: 6, width: 7, height: 8 },
      emptyOverlay,
      {
        data: new Uint8Array([
          0, 0, 0, 0, 0, 0, 0,
          0, 0, 255, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0,
        ]),
        width: 7,
        height: 8,
        bounds: { x: 5, y: 6, width: 7, height: 8 },
      }
    );

    expect(getAlpha(eraseMask, 7, 7)).toBe(0);
    expect(getAlpha(eraseMask, 7, 9)).toBe(255);
    expect(updateLayer).toHaveBeenCalledWith(
      layerId,
      { colorCycleData: { eraseMaskVersion: 3 } },
      { skipColorCycleSync: true }
    );
  });
});
