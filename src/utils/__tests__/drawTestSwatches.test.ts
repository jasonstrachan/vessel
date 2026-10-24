import { cloneLayerImageData, commitLayerHistory } from '@/history/helpers/layerHistory';
import type { Layer } from '@/types';
import { drawTestSwatches } from '@/utils/drawTestSwatches';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

jest.mock('@/history/helpers/layerHistory', () => ({
  ...jest.requireActual('@/history/helpers/layerHistory'),
  commitLayerHistory: jest.fn().mockResolvedValue(undefined),
}));

const commit = jest.mocked(commitLayerHistory);
const makeLayer = (): Layer => {
  const imageData = new ImageData(new Uint8ClampedArray([12, 34, 56, 255]), 1, 1);
  const framebuffer = document.createElement('canvas');
  framebuffer.width = framebuffer.height = 1;
  framebuffer.getContext('2d')!.putImageData(imageData, 0, 0);
  return {
    id: 'target',
    name: 'Target',
    layerType: 'normal',
    visible: true,
    locked: false,
    order: 0,
    opacity: 1,
    blendMode: 'source-over',
    alignment: createDefaultLayerAlignment(),
    imageData,
    framebuffer,
  };
};

describe('Draw Test Swatches history', () => {
  const originalStore = Object.getOwnPropertyDescriptor(window, '__vesselStore');
  const canvasPrototype = CanvasRenderingContext2D.prototype;
  const originalStrokeRect = Object.getOwnPropertyDescriptor(canvasPrototype, 'strokeRect');
  const originalFillText = Object.getOwnPropertyDescriptor(canvasPrototype, 'fillText');
  let layer: Layer;
  let canvas: HTMLCanvasElement;
  let capture: jest.Mock<Promise<void>, [HTMLCanvasElement]>;
  let state: {
    layers: Layer[];
    activeLayerId: string | null;
    currentOffscreenCanvas: HTMLCanvasElement;
    history: { isCapturing: boolean };
    captureCanvasToActiveLayer: typeof capture;
  };

  beforeAll(() => {
    Object.defineProperty(canvasPrototype, 'strokeRect', { configurable: true, value: jest.fn() });
    Object.defineProperty(canvasPrototype, 'fillText', { configurable: true, value: jest.fn() });
  });

  beforeEach(() => {
    commit.mockClear();
    layer = makeLayer();
    canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 320;
    capture = jest.fn<Promise<void>, [HTMLCanvasElement]>(async () => {
      // Capture may reuse and mutate the old image storage. History must already own a copy.
      layer.imageData!.data.set([200, 100, 50, 255]);
    });
    state = {
      layers: [layer],
      activeLayerId: layer.id,
      currentOffscreenCanvas: canvas,
      history: { isCapturing: false },
      captureCanvasToActiveLayer: capture,
    };
    Object.defineProperty(window, '__vesselStore', {
      configurable: true,
      value: { getState: () => state },
    });
  });

  afterAll(() => {
    if (originalStore) Object.defineProperty(window, '__vesselStore', originalStore);
    else Reflect.deleteProperty(window, '__vesselStore');
    if (originalStrokeRect) Object.defineProperty(canvasPrototype, 'strokeRect', originalStrokeRect);
    else Reflect.deleteProperty(canvasPrototype, 'strokeRect');
    if (originalFillText) Object.defineProperty(canvasPrototype, 'fillText', originalFillText);
    else Reflect.deleteProperty(canvasPrototype, 'fillText');
  });

  it('records one edit after capture with the original target pixels copied before mutation', async () => {
    const original = cloneLayerImageData(layer.imageData);

    await drawTestSwatches();

    expect(capture).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(capture.mock.invocationCallOrder[0]).toBeLessThan(commit.mock.invocationCallOrder[0]);
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({
      layerId: 'target',
      beforeImage: original,
      beforeColorState: null,
      actionType: 'brush',
      description: 'Draw test swatches',
      tool: 'brush',
    }));
    expect(commit.mock.calls[0][0].beforeImage).not.toBe(layer.imageData);
    expect([...layer.imageData!.data]).toEqual([200, 100, 50, 255]);
  });

  it('keeps history bound to the captured layer if activation changes while capture settles', async () => {
    capture.mockImplementation(async () => {
      state.activeLayerId = 'other';
      state.layers = [layer, { ...makeLayer(), id: 'other' }];
    });

    await drawTestSwatches();

    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ layerId: 'target' }));
  });

  it('authors only a transparent overlay and leaves the shared composite untouched', async () => {
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, 20, 20);
    const original = context.getImageData(0, 0, 512, 320);

    await drawTestSwatches();

    const overlay = capture.mock.calls[0][0];
    expect(overlay).not.toBe(canvas);
    expect(overlay.width).toBe(512);
    expect(overlay.height).toBe(320);
    expect(context.getImageData(0, 0, 512, 320)).toEqual(original);
    expect([...overlay.getContext('2d')!.getImageData(10, 10, 1, 1).data]).toEqual([0, 0, 0, 0]);
  });

  it.each(['locked', 'color-cycle', 'capturing', 'missing'] as const)(
    'does not mutate the shared canvas or record history for a %s target',
    async (kind) => {
      if (kind === 'locked') layer.locked = true;
      if (kind === 'color-cycle') layer.layerType = 'color-cycle';
      if (kind === 'capturing') state.history.isCapturing = true;
      if (kind === 'missing') state.activeLayerId = null;
      const context = canvas.getContext('2d')!;
      const draw = jest.spyOn(context, 'fillRect');

      await drawTestSwatches();

      expect(draw).not.toHaveBeenCalled();
      expect(capture).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
      draw.mockRestore();
    },
  );
});
