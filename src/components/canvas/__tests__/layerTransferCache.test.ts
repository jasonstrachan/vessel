import type { Layer } from '@/types';
import { getLayerTransferCanvas } from '@/components/canvas/layerTransferCache';

const createLayer = (overrides: Partial<Layer> = {}): Layer =>
  ({
    id: overrides.id ?? 'layer-1',
    imageData: overrides.imageData ?? new ImageData(4, 4),
    version: overrides.version ?? 1,
  } as unknown as Layer);

describe('layerTransferCache', () => {
  it('reuses transfer canvas and skips putImageData when layer pixels are unchanged', () => {
    const cache = new Map();
    const putImageDataSpy = jest.spyOn(CanvasRenderingContext2D.prototype, 'putImageData');

    const layer = createLayer({ id: 'same', imageData: new ImageData(8, 8), version: 10 });

    const firstCanvas = getLayerTransferCanvas(layer, cache);
    expect(firstCanvas).toBeTruthy();
    expect(putImageDataSpy).toHaveBeenCalledTimes(1);

    const secondCanvas = getLayerTransferCanvas(layer, cache);
    expect(secondCanvas).toBe(firstCanvas);
    expect(putImageDataSpy).toHaveBeenCalledTimes(1);

    putImageDataSpy.mockRestore();
  });

  it('re-uploads when layer version, image reference, or dimensions change', () => {
    const cache = new Map();
    const putImageDataSpy = jest.spyOn(CanvasRenderingContext2D.prototype, 'putImageData');

    const base = createLayer({ id: 'layer-a', imageData: new ImageData(8, 8), version: 1 });
    getLayerTransferCanvas(base, cache);
    expect(putImageDataSpy).toHaveBeenCalledTimes(1);

    const sharedImageData = new ImageData(8, 8);
    const newImageSameVersion = createLayer({
      id: 'layer-a',
      imageData: sharedImageData,
      version: 1,
    });
    getLayerTransferCanvas(newImageSameVersion, cache);
    expect(putImageDataSpy).toHaveBeenCalledTimes(2);

    const sameImageNewVersion = createLayer({
      id: 'layer-a',
      imageData: sharedImageData,
      version: 2,
    });
    getLayerTransferCanvas(sameImageNewVersion, cache);
    expect(putImageDataSpy).toHaveBeenCalledTimes(3);

    const resized = createLayer({
      id: 'layer-a',
      imageData: new ImageData(16, 16),
      version: 3,
    });
    getLayerTransferCanvas(resized, cache);
    expect(putImageDataSpy).toHaveBeenCalledTimes(4);

    putImageDataSpy.mockRestore();
  });
});
