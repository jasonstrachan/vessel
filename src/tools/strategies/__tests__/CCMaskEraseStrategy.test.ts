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

  it('stamps taps and segment junctions once at partial opacity', () => {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = 10;
    maskCanvas.height = 10;
    const strategy = new CCMaskEraseStrategy(
      {
        getMask: jest.fn(() => maskCanvas),
        bumpVersion: jest.fn(),
      } as unknown as MaskManager,
      'layer-1',
      () => ({
        size: 1,
        pressureEnabled: false,
        minPressure: 0,
        maxPressure: 1,
        brushShape: BrushShape.SQUARE,
      })
    );

    strategy.begin({ id: 'layer-1', layerType: 'color-cycle' } as Layer, { opacity: 0.5 });
    strategy.stamp({ x: 2, y: 2 }, { x: 2, y: 2 }, 1, null);
    strategy.stamp({ x: 2, y: 2 }, { x: 6, y: 2 }, 1, null);
    strategy.end();

    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    expect(maskCtx).not.toBeNull();
    expect(maskCtx!.getImageData(2, 2, 1, 1).data[3]).toBe(128);
    expect(maskCtx!.getImageData(6, 2, 1, 1).data[3]).toBe(128);
  });

  it('preserves the pixel-round eraser tip geometry in the mask and preview', () => {
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 12;
    overlayCanvas.height = 12;
    const overlayCtx = overlayCanvas.getContext('2d', { willReadFrequently: true });
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = 12;
    maskCanvas.height = 12;
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    expect(maskCtx).not.toBeNull();
    expect(overlayCtx).not.toBeNull();
    const maskDrawImage = jest.spyOn(maskCtx!, 'drawImage');
    const overlayDrawImage = jest.spyOn(overlayCtx!, 'drawImage');
    const strategy = new CCMaskEraseStrategy(
      {
        getMask: jest.fn(() => maskCanvas),
        bumpVersion: jest.fn(),
      } as unknown as MaskManager,
      'layer-1',
      () => ({
        size: 10,
        pressureEnabled: false,
        minPressure: 0,
        maxPressure: 1,
        brushShape: BrushShape.PIXEL_ROUND,
      }),
      overlayCtx
    );

    strategy.begin({ id: 'layer-1', layerType: 'color-cycle' } as Layer, { opacity: 1 });
    strategy.stamp({ x: 6, y: 6 }, { x: 6, y: 6 }, 1, null);
    strategy.end();

    expect(maskDrawImage).toHaveBeenCalledTimes(1);
    expect(overlayDrawImage).toHaveBeenCalledTimes(1);
    const stamp = maskDrawImage.mock.calls[0][0] as HTMLCanvasElement;
    expect(overlayDrawImage.mock.calls[0][0]).toBe(stamp);
    expect(stamp.width).toBe(10);
    expect(stamp.height).toBe(10);
    const stampCtx = stamp.getContext('2d', { willReadFrequently: true });
    expect(stampCtx).not.toBeNull();
    for (const [x, y] of [[5, 5], [5, 1], [1, 5]]) {
      expect(stampCtx!.getImageData(x, y, 1, 1).data[3]).toBeGreaterThan(0);
    }
    for (const [x, y] of [[0, 0], [9, 0]]) {
      expect(stampCtx!.getImageData(x, y, 1, 1).data[3]).toBe(0);
    }
  });

  it('preserves the Diamond5 eraser tip geometry in the mask and preview', () => {
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 12;
    overlayCanvas.height = 12;
    const overlayCtx = overlayCanvas.getContext('2d', { willReadFrequently: true });
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
        size: 10,
        pressureEnabled: false,
        minPressure: 0,
        maxPressure: 1,
        brushShape: BrushShape.PIXEL_DITHER,
      }),
      overlayCtx
    );

    strategy.begin({ id: 'layer-1', layerType: 'color-cycle' } as Layer, { opacity: 1 });
    strategy.stamp({ x: 6, y: 6 }, { x: 6, y: 6 }, 1, null);
    strategy.end();

    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    expect(maskCtx).not.toBeNull();
    expect(overlayCtx).not.toBeNull();
    for (const [x, y] of [[6, 6], [6, 2], [2, 6]]) {
      expect(maskCtx!.getImageData(x, y, 1, 1).data[3]).toBeGreaterThan(0);
      expect(overlayCtx!.getImageData(x, y, 1, 1).data[3]).toBeGreaterThan(0);
    }
    for (const [x, y] of [[2, 2], [9, 2]]) {
      expect(maskCtx!.getImageData(x, y, 1, 1).data[3]).toBe(0);
      expect(overlayCtx!.getImageData(x, y, 1, 1).data[3]).toBe(0);
    }
  });
});
