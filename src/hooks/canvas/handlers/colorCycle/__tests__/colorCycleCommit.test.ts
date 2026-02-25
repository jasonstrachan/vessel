import { commitRasterOverlay } from '@/hooks/canvas/handlers/colorCycle/colorCycleCommit';
import { setOverlaySeededFromLayer } from '@/hooks/canvas/utils/overlaySeedState';
import type { Layer } from '@/types';

const createLayer = (): Layer =>
  ({
    id: 'layer-1',
    name: 'Layer 1',
    visible: true,
    opacity: 1,
    order: 0,
    imageData: null,
    colorCycleData: null,
    layerType: 'normal',
    framebuffer: document.createElement('canvas'),
  }) as unknown as Layer;

describe('commitRasterOverlay', () => {
  it('reuses the same temp canvas across calls', async () => {
    const captureCanvasToActiveLayer = jest.fn().mockResolvedValue(undefined);
    const deps = {
      project: { width: 16, height: 16 },
      captureCanvasToActiveLayer,
      scheduleHistoryCommit: jest.fn().mockResolvedValue(undefined),
      withTiming: async <T,>(_label: string, task: () => Promise<T> | T): Promise<T> => task(),
    };

    const options = {
      layer: createLayer(),
      overlayCanvas: null,
      beforeImage: null,
      beforeColorState: null,
      historyAction: 'brush' as const,
      historyDescription: 'test',
      tool: 'brush',
      skipHistory: true,
    };

    await commitRasterOverlay(options, deps);
    await commitRasterOverlay(options, deps);

    expect(captureCanvasToActiveLayer).toHaveBeenCalledTimes(2);
    const firstCanvas = captureCanvasToActiveLayer.mock.calls[0]?.[0];
    const secondCanvas = captureCanvasToActiveLayer.mock.calls[1]?.[0];
    expect(firstCanvas).toBe(secondCanvas);
  });

  it('seeds temp canvas from framebuffer before overlay merge', async () => {
    const layer = createLayer();
    layer.imageData = new ImageData(new Uint8ClampedArray([
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]), 2, 2);
    layer.framebuffer.width = 2;
    layer.framebuffer.height = 2;
    const fbCtx = layer.framebuffer.getContext('2d') as CanvasRenderingContext2D | null;
    fbCtx?.putImageData(new ImageData(new Uint8ClampedArray([
      0, 0, 255, 255,
      0, 0, 255, 255,
      0, 0, 255, 255,
      0, 0, 255, 255,
    ]), 2, 2), 0, 0);

    const overlay = document.createElement('canvas');
    overlay.width = 2;
    overlay.height = 2;
    const overlayCtx = overlay.getContext('2d');
    overlayCtx?.putImageData(new ImageData(new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]), 2, 2), 0, 0);

    const drawImageSpy = jest.spyOn(CanvasRenderingContext2D.prototype, 'drawImage');
    const captureCanvasToActiveLayer = jest.fn().mockResolvedValue(undefined);

    await commitRasterOverlay(
      {
        layer,
        overlayCanvas: overlay,
        beforeImage: null,
        beforeColorState: null,
        historyAction: 'brush',
        historyDescription: 'test',
        tool: 'brush',
        skipHistory: true,
      },
      {
        project: { width: 2, height: 2 },
        captureCanvasToActiveLayer,
        scheduleHistoryCommit: jest.fn().mockResolvedValue(undefined),
        withTiming: async <T,>(_label: string, task: () => Promise<T> | T): Promise<T> => task(),
      }
    );

    expect(captureCanvasToActiveLayer).toHaveBeenCalledTimes(1);
    expect(drawImageSpy).toHaveBeenCalled();
    expect(drawImageSpy.mock.calls[0]?.[0]).toBe(layer.framebuffer);
    drawImageSpy.mockRestore();
  });

  it('uses replace capture mode when overlay is seeded from active layer', async () => {
    const layer = createLayer();
    layer.framebuffer.width = 2;
    layer.framebuffer.height = 2;

    const overlay = document.createElement('canvas');
    overlay.width = 2;
    overlay.height = 2;
    const overlayCtx = overlay.getContext('2d');
    overlayCtx?.fillRect(0, 0, 2, 2);
    setOverlaySeededFromLayer(overlay, true);

    const captureCanvasToActiveLayer = jest.fn().mockResolvedValue(undefined);
    await commitRasterOverlay(
      {
        layer,
        overlayCanvas: overlay,
        beforeImage: null,
        beforeColorState: null,
        historyAction: 'brush',
        historyDescription: 'test',
        tool: 'brush',
        skipHistory: true,
      },
      {
        project: { width: 2, height: 2 },
        captureCanvasToActiveLayer,
        scheduleHistoryCommit: jest.fn().mockResolvedValue(undefined),
        withTiming: async <T,>(_label: string, task: () => Promise<T> | T): Promise<T> => task(),
      }
    );

    expect(captureCanvasToActiveLayer).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      undefined,
      { mode: 'replace' }
    );
  });
});
