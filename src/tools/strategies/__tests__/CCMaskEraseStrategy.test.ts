import { CCMaskEraseStrategy } from '@/tools/strategies/CCMaskEraseStrategy';
import { BrushShape } from '@/types';
import type { MaskManager } from '@/layers/MaskManager';
import type { Layer } from '@/types';

describe('CCMaskEraseStrategy', () => {
  it('updates the preview overlay while stamping the erase mask', () => {
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 12;
    overlayCanvas.height = 12;
    const overlayCtx = overlayCanvas.getContext('2d', { willReadFrequently: true });
    expect(overlayCtx).not.toBeNull();
    const overlayFillRectSpy = jest.spyOn(overlayCtx!, 'fillRect');

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = 12;
    maskCanvas.height = 12;
    const maskManager = {
      getMask: jest.fn(() => maskCanvas),
      bumpVersion: jest.fn(),
    };

    const strategy = new CCMaskEraseStrategy(
      maskManager as unknown as MaskManager,
      'layer-1',
      () => ({
        size: 4,
        pressureEnabled: false,
        minPressure: 0,
        maxPressure: 1,
        brushShape: BrushShape.COLOR_CYCLE_SHAPE,
      }),
      overlayCtx
    );

    strategy.begin({ id: 'layer-1', layerType: 'color-cycle' } as Layer, { opacity: 1 });
    strategy.stamp({ x: 6, y: 6 }, { x: 6, y: 6 }, 1, null);
    strategy.end();

    const maskAlpha = maskCanvas.getContext('2d', { willReadFrequently: true })!
      .getImageData(6, 6, 1, 1).data[3];

    expect(overlayFillRectSpy).toHaveBeenCalled();
    expect(maskAlpha).toBeGreaterThan(0);
    expect(maskManager.bumpVersion).toHaveBeenCalledWith('layer-1');
  });
});
