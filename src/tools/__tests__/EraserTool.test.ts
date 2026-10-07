import { EraserTool } from '@/tools/EraserTool';
import { BrushShape, type Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { MaskManager } from '@/layers/MaskManager';
import type { BrushStampSource } from '@/tools/stamps/BrushStampSource';

describe('EraserTool', () => {
  it.each(['normal', 'sequential', 'color-cycle'] as const)(
    'clips the %s authoring target before the first erase stamp',
    (layerType) => {
      const overlay = document.createElement('canvas');
      const mask = document.createElement('canvas');
      const overlayCtx = overlay.getContext('2d')!;
      const targetCtx = layerType === 'color-cycle' ? mask.getContext('2d')! : overlayCtx;
      const clip = jest.spyOn(targetCtx, 'clip');
      const rect = jest.spyOn(targetCtx, 'rect');
      const restore = jest.spyOn(targetCtx, 'restore');
      const stamp = jest.fn(() => expect(clip).toHaveBeenCalledTimes(1));
      const fill = jest.spyOn(targetCtx, 'fillRect');
      const tool = new EraserTool({ id: 'selected', layerType } as Layer, {
        opacity: 1,
        selection: {
          selectionStart: { x: 12, y: 10 }, selectionEnd: { x: 2, y: 4 },
          selectionMask: null, selectionMaskBounds: null,
        },
      }, {
        overlayCtx,
        maskManager: { getMask: () => mask, bumpVersion: jest.fn() } as unknown as MaskManager,
        createStampSource: () => ({ begin: stamp, end: jest.fn() } as unknown as BrushStampSource),
        brushHalfSize: () => 2,
        getBrushSettings: () => ({
          size: 4, pressureEnabled: false, minPressure: 0, maxPressure: 100,
          brushShape: BrushShape.SQUARE,
        }),
      });

      tool.begin({ x: 8, y: 8 });
      expect(rect).toHaveBeenCalledWith(2, 4, 10, 6);
      expect(clip).toHaveBeenCalledTimes(1);
      if (layerType === 'color-cycle') {
        expect(clip.mock.invocationCallOrder[0]).toBeLessThan(fill.mock.invocationCallOrder[0]);
      } else {
        expect(stamp).toHaveBeenCalled();
      }
      tool.end();
      expect(restore).toHaveBeenCalled();
    },
  );

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

  it('includes the full minimum Diamond5 stamp in the history ROI', () => {
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 24;
    overlayCanvas.height = 24;
    const overlayCtx = overlayCanvas.getContext('2d', { willReadFrequently: true });
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
    expect(overlayCtx).not.toBeNull();
    const tool = new EraserTool(layer, { opacity: 1 }, {
      overlayCtx: overlayCtx!,
      maskManager: {
        getMask: jest.fn(() => maskCanvas),
        bumpVersion: jest.fn(),
      } as unknown as MaskManager,
      createStampSource: jest.fn() as unknown as () => BrushStampSource,
      brushHalfSize: () => 0.5,
      getBrushSettings: () => ({
        size: 1,
        pressureEnabled: false,
        minPressure: 0,
        maxPressure: 1,
        brushShape: BrushShape.PIXEL_DITHER,
      }),
    });

    tool.begin({ x: 10, y: 10 }, 1);

    expect(tool.getROI()).toEqual({ x: 5, y: 5, width: 10, height: 10 });
  });
});
