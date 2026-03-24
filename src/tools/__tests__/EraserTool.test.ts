import { EraserTool } from '@/tools/EraserTool';
import { BrushShape, type Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { MaskManager } from '@/layers/MaskManager';
import type { BrushStampSource } from '@/tools/stamps/BrushStampSource';

describe('EraserTool', () => {
  it('applies an initial stamp on begin for color-cycle layers', () => {
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 24;
    overlayCanvas.height = 24;
    const overlayCtx = overlayCanvas.getContext('2d', { willReadFrequently: true });
    expect(overlayCtx).not.toBeNull();
    const overlayFillRectSpy = jest.spyOn(overlayCtx!, 'fillRect');

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = 24;
    maskCanvas.height = 24;
    const layer: Layer = {
      id: 'layer-cc',
      name: 'CC',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: maskCanvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        canvas: maskCanvas,
        hasContent: true,
        gradient: [],
      },
    };

    const tool = new EraserTool(layer, { opacity: 1 }, {
      overlayCtx: overlayCtx!,
      maskManager: {
        getMask: jest.fn(() => maskCanvas),
        bumpVersion: jest.fn(),
      } as unknown as MaskManager,
      createStampSource: jest.fn() as unknown as () => BrushStampSource,
      brushHalfSize: () => 6,
      getBrushSettings: () => ({
        size: 8,
        pressureEnabled: false,
        minPressure: 0,
        maxPressure: 1,
        brushShape: BrushShape.COLOR_CYCLE_SHAPE,
      }),
    });

    tool.begin({ x: 10, y: 12 }, 1);

    expect(overlayFillRectSpy).toHaveBeenCalled();
    expect(tool.getROI()).toEqual({ x: 2, y: 4, width: 16, height: 16 });
  });
});
