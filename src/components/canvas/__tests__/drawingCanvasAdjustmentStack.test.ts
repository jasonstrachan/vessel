import { drawAdjustmentCompositeStack } from '@/components/canvas/drawingCanvasAdjustmentStack';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createLayer = (id: string, order: number, overrides: Partial<Layer> = {}): Layer => ({
  id,
  name: id,
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  order,
  imageData: null,
  framebuffer: document.createElement('canvas'),
  alignment: createDefaultLayerAlignment(),
  layerType: 'normal',
  ...overrides,
});

describe('drawAdjustmentCompositeStack', () => {
  const rasterGlobals = globalThis as typeof globalThis & { __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean };
  beforeEach(() => { rasterGlobals.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true; });
  afterEach(() => {
    jest.restoreAllMocks();
    delete rasterGlobals.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
  });

  it('applies screen and opacity in ordered art space before the single presentation blit', () => {
    const output = document.createElement('canvas'); output.width = output.height = 1;
    const ctx = output.getContext('2d')!;
    const lower = createLayer('blue', 0);
    const upper = createLayer('red', 1, { blendMode: 'screen', opacity: 0.5 });
    const calls: Array<{ source: CanvasImageSource; target: CanvasRenderingContext2D; blend: GlobalCompositeOperation; alpha: number }> = [];
    const original = CanvasRenderingContext2D.prototype.drawImage;
    jest.spyOn(CanvasRenderingContext2D.prototype, 'drawImage').mockImplementation(function (this: CanvasRenderingContext2D, ...args: Parameters<typeof original>) {
      calls.push({ source: args[0], target: this, blend: this.globalCompositeOperation, alpha: this.globalAlpha });
      return original.apply(this, args);
    });
    expect(drawAdjustmentCompositeStack({ ctx, visibleRect: { x: 0, y: 0, width: 1, height: 1 },
      destination: { x: 0, y: 0, width: 1, height: 1 }, sortedLayers: [lower, upper],
      storeState: { project: { width: 1, height: 1, backgroundColor: 'transparent' }, layerGroups: [] } as unknown as AppState,
      shouldHoldPreviousSequentialFrame: false })).toBe(true);
    expect(calls.map(call => [call.source, call.blend, call.alpha])).toEqual([
      [lower.framebuffer, 'source-over', 1], [upper.framebuffer, 'screen', 0.5],
      [expect.anything(), 'source-over', 1],
    ]);
    expect(calls[0].target).toBe(calls[1].target);
    expect(calls[0].target).not.toBe(ctx);
    expect(calls[2].target).toBe(ctx);
  });

  it('composes canonical-only screen source on transparent art, then blits neutral over presentation', () => {
    const output = document.createElement('canvas'); output.width = output.height = 4;
    const ctx = output.getContext('2d')!;
    ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 4, 4);
    ctx.globalAlpha = 0.25; ctx.globalCompositeOperation = 'multiply';
    const stateStack: Array<{ alpha: number; blend: GlobalCompositeOperation }> = [];
    jest.spyOn(ctx, 'save').mockImplementation(() => { stateStack.push({ alpha: ctx.globalAlpha, blend: ctx.globalCompositeOperation }); });
    jest.spyOn(ctx, 'restore').mockImplementation(() => {
      const state = stateStack.pop();
      if (state) { ctx.globalAlpha = state.alpha; ctx.globalCompositeOperation = state.blend; }
    });
    const originalDraw = ctx.drawImage.bind(ctx);
    const draw = jest.spyOn(ctx, 'drawImage');
    let blitState: unknown;
    draw.mockImplementation((...args: Parameters<typeof ctx.drawImage>) => {
      blitState = { alpha: ctx.globalAlpha, blend: ctx.globalCompositeOperation };
      return originalDraw(...args);
    });
    const red = new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1);
    const layer = createLayer('red', 0, { framebuffer: undefined, imageData: red, blendMode: 'screen' });
    expect(drawAdjustmentCompositeStack({ ctx, visibleRect: { x: 0, y: 0, width: 1, height: 1 },
      destination: { x: 1, y: 2, width: 2, height: 1 }, sortedLayers: [layer],
      storeState: { project: { width: 1, height: 1, backgroundColor: 'transparent' }, layerGroups: [] } as unknown as AppState,
      shouldHoldPreviousSequentialFrame: false })).toBe(true);
    expect([...ctx.getImageData(1, 2, 1, 1).data]).toEqual([255, 0, 0, 255]);
    expect([...ctx.getImageData(0, 0, 1, 1).data]).toEqual([0, 255, 0, 255]);
    expect(blitState).toEqual({ alpha: 1, blend: 'source-over' });
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, 1, 1, 1, 2, 2, 1);
    expect(ctx.globalAlpha).toBe(0.25);
    expect(ctx.globalCompositeOperation).toBe('multiply');
  });

  it.each(['rectangle', 'mask'] as const)('clips live paint to the %s selection without clipping committed layer pixels', (kind) => {
    const originalPath2D = global.Path2D;
    class SelectionPath {
      rect = jest.fn();
      moveTo = jest.fn();
      lineTo = jest.fn();
      closePath = jest.fn();
    }
    global.Path2D = SelectionPath as unknown as typeof Path2D;
    try {
      const output = document.createElement('canvas');
      output.width = output.height = 8;
      const ctx = output.getContext('2d')!;
      const layer = createLayer('paint', 0, { opacity: 0.5 });
      const overlay = document.createElement('canvas');
      overlay.width = overlay.height = 16;
      const mask = new ImageData(2, 2);
      mask.data[3] = 255;
      const clip = jest.spyOn(CanvasRenderingContext2D.prototype, 'clip');
      const originalDraw = CanvasRenderingContext2D.prototype.drawImage;
      const clippedDraws: Array<{ source: CanvasImageSource; clipCount: number; alpha: number }> = [];
      jest.spyOn(CanvasRenderingContext2D.prototype, 'drawImage').mockImplementation(function (this: CanvasRenderingContext2D, ...args: Parameters<typeof originalDraw>) {
        clippedDraws.push({ source: args[0], clipCount: clip.mock.calls.length, alpha: this.globalAlpha });
        return originalDraw.apply(this, args);
      });
      expect(drawAdjustmentCompositeStack({
        ctx, visibleRect: { x: 4, y: 6, width: 8, height: 8 },
        destination: { x: 0, y: 0, width: 8, height: 8 }, sortedLayers: [layer],
        storeState: {
          project: { width: 16, height: 16, backgroundColor: 'transparent' }, layerGroups: [],
          selectionStart: { x: 5, y: 7 }, selectionEnd: { x: 7, y: 9 },
          selectionMask: kind === 'mask' ? mask : null,
          selectionMaskBounds: kind === 'mask' ? { x: 5, y: 7, width: 2, height: 2 } : null,
        } as unknown as AppState,
        shouldHoldPreviousSequentialFrame: false,
        liveLayerOverlay: { layerId: layer.id, canvas: overlay, mode: 'over' },
      })).toBe(true);
      expect(clippedDraws.find(draw => draw.source === layer.framebuffer)?.clipCount).toBe(0);
      expect(clippedDraws.find(draw => draw.source === overlay)).toMatchObject({ clipCount: 1, alpha: 0.5 });
      expect(clip).toHaveBeenCalledTimes(1);
      if (kind === 'rectangle') {
        expect((clip.mock.calls[0][0] as unknown as SelectionPath).rect).toHaveBeenCalledWith(5, 7, 2, 2);
      }
    } finally {
      global.Path2D = originalPath2D;
    }
  });

  it('disables smoothing on the viewport surface before resampling visible pixels', () => {
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = 16;
    outputCanvas.height = 16;
    const outputContext = outputCanvas.getContext('2d');
    if (!outputContext) throw new Error('Expected a Canvas2D context');
    const source = createLayer('source', 0);
    const adjustment = createLayer('adjustment', 1, {
      layerType: 'adjustment',
      adjustmentData: {
        effect: {
          id: 'hue-sat',
          settings: {
            hue: 0,
            saturation: 0,
            vibrance: 0,
            lightness: 0,
            contrast: 0,
            red: 0,
            green: 0,
            blue: 0,
            hueRangeEnabled: false,
            hueRangeStart: 0,
            hueRangeEnd: 360,
          },
        },
      },
    });
    const createdContexts: CanvasRenderingContext2D[] = [];
    const createElement = document.createElement.bind(document);
    const drawImageSpy = jest.spyOn(CanvasRenderingContext2D.prototype, 'drawImage');
    jest.spyOn(document, 'createElement').mockImplementation((tagName) => {
      const element = createElement(tagName);
      if (tagName === 'canvas') {
        const context = (element as HTMLCanvasElement).getContext('2d');
        if (context) createdContexts.push(context);
      }
      return element;
    });

    expect(drawAdjustmentCompositeStack({
      ctx: outputContext,
      visibleRect: { x: 0.25, y: 0.25, width: 8.5, height: 8.5 },
      destination: { x: 0.25, y: 0.25, width: 8.5, height: 8.5 },
      sortedLayers: [source, adjustment],
      storeState: {
        project: { width: 16, height: 16, backgroundColor: 'transparent' },
        layerGroups: [],
      } as unknown as AppState,
      shouldHoldPreviousSequentialFrame: false,
    })).toBe(true);

    expect(createdContexts.length).toBeGreaterThan(0);
    expect(createdContexts.every((context) => context.imageSmoothingEnabled === false)).toBe(true);
    expect(drawImageSpy).toHaveBeenCalledWith(
      source.framebuffer,
      0,
      0,
      9,
      9,
      0,
      0,
      9,
      9,
    );
  });
});
