import { act, renderHook } from '@testing-library/react';
import { useDrawingCanvasCompositeBuffers } from '@/components/canvas/useDrawingCanvasCompositeBuffers';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const mockGetState = jest.fn();

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: {
    getState: () => mockGetState(),
  },
}));

const createRasterLayer = (id: string, order: number, version = 1): Layer =>
  ({
    id,
    name: id,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order,
    imageData: new ImageData(32, 32),
    framebuffer: null,
    alignment: createDefaultLayerAlignment(),
    layerType: 'normal',
    version,
  } as unknown as Layer);

const createOptions = (layers: Layer[]) => ({
  project: { width: 64, height: 64 },
  layers,
  activeLayerId: null as string | null,
  brushShape: undefined,
  antialiasing: true,
  displayMode: 'smooth' as const,
  layerTransferCacheRef: { current: new Map() },
  underCompositeCanvasRef: { current: null as HTMLCanvasElement | null },
  overCompositeCanvasRef: { current: null as HTMLCanvasElement | null },
  underCompositeHasContentRef: { current: false },
  overCompositeHasContentRef: { current: false },
  compositeCanvasRef: { current: null as HTMLCanvasElement | null },
  renderStaticComposite: jest.fn(() => true),
  setCurrentOffscreenCanvas: jest.fn(),
});

describe('useDrawingCanvasCompositeBuffers performance smoke', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetState.mockReturnValue({
      sequentialRecord: { currentFrame: 0 },
    });
  });

  it('avoids repeated putImageData uploads for unchanged raster layers', () => {
    const putImageDataSpy = jest.spyOn(CanvasRenderingContext2D.prototype, 'putImageData');

    const baseLayers = [
      createRasterLayer('layer-a', 0, 1),
      createRasterLayer('layer-b', 1, 1),
    ];
    const options = createOptions(baseLayers);

    const { result, rerender } = renderHook(
      ({ hookOptions }) => useDrawingCanvasCompositeBuffers(hookOptions),
      { initialProps: { hookOptions: options } }
    );

    act(() => {
      result.current.renderSplitComposites();
    });
    expect(putImageDataSpy).toHaveBeenCalledTimes(2);

    act(() => {
      result.current.renderSplitComposites();
    });
    expect(putImageDataSpy).toHaveBeenCalledTimes(2);

    const updatedLayers = [
      { ...baseLayers[0], version: 2 },
      baseLayers[1],
    ];

    rerender({
      hookOptions: {
        ...options,
        layers: updatedLayers,
      },
    });

    act(() => {
      result.current.renderSplitComposites();
    });
    expect(putImageDataSpy).toHaveBeenCalledTimes(3);

    putImageDataSpy.mockRestore();
  });
});
