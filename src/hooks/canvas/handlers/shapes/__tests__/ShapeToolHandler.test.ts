import { shapeFillBrushPreset, pixelBrushPreset } from '@/presets/brushPresets';
import { __shapeToolTestUtils } from '@/hooks/canvas/handlers/shapes/ShapeToolHandler';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';

describe('ShapeToolHandler – shape fill tool detection', () => {
  const store = useAppStore.getState();

  beforeEach(() => {
    store.setBrushPreset(shapeFillBrushPreset);
    store.setCurrentTool('brush');
  });

  afterEach(() => {
    store.setBrushPreset(pixelBrushPreset);
    store.setCurrentTool('brush');
  });

  it('treats shape fill brush as inactive when the current tool is not brush', () => {
    expect(__shapeToolTestUtils.isShapeFillToolActive()).toBe(true);

    store.setCurrentTool('eraser');

    expect(__shapeToolTestUtils.isShapeFillToolActive()).toBe(false);
  });

  it('masks shape-fill overlay when layer transparency lock is enabled', () => {
    const overlay = document.createElement('canvas');
    overlay.width = 2;
    overlay.height = 1;
    const overlayCtx = overlay.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    overlayCtx.fillStyle = 'rgba(255, 0, 0, 1)';
    overlayCtx.fillRect(0, 0, 2, 1);

    const framebuffer = document.createElement('canvas');
    framebuffer.width = 2;
    framebuffer.height = 1;
    const drawImageSpy = jest.spyOn(overlayCtx, 'drawImage');

    const lockedLayer = {
      transparencyLocked: true,
      imageData: null,
      framebuffer,
    } as Layer;

    __shapeToolTestUtils.applyTransparencyLockMaskToContext(overlayCtx, lockedLayer);

    expect(drawImageSpy).toHaveBeenCalledWith(framebuffer, 0, 0, 2, 1);
    drawImageSpy.mockRestore();
  });
});
