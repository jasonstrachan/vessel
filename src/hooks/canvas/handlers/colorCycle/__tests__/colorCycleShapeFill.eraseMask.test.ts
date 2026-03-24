import { clearColorCycleShapeEraseMask } from '@/hooks/canvas/handlers/colorCycle/colorCycleShapeFill';
import { useAppStore } from '@/stores/useAppStore';

describe('colorCycleShapeFill erase mask healing', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('clears the erase mask in the finalized ROI for shape fills', () => {
    const clearRect = jest.fn();
    const eraseMask = {
      width: 32,
      height: 32,
      getContext: jest.fn(() => ({ clearRect })),
    } as unknown as HTMLCanvasElement;
    const updateLayer = jest.fn();
    const activeLayerCanvas = document.createElement('canvas');
    activeLayerCanvas.width = 32;
    activeLayerCanvas.height = 32;

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

    clearColorCycleShapeEraseMask(layerId, { x: 5, y: 6, width: 7, height: 8 });

    expect(clearRect).toHaveBeenCalledWith(5, 6, 7, 8);
    expect(updateLayer).toHaveBeenCalledWith(
      layerId,
      { colorCycleData: { eraseMaskVersion: 3 } },
      { skipColorCycleSync: true }
    );
  });
});
