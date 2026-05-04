import {
  getColorCyclePresentationCanvas,
  resolveColorCyclePresentation,
} from '@/components/canvas/resolveColorCyclePresentation';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createLayer = (overrides: Partial<Layer>): Layer => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = 16;
  framebuffer.height = 16;

  return {
    id: 'cc-layer',
    name: 'CC Layer',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData: null,
    framebuffer,
    alignment: createDefaultLayerAlignment(),
    layerType: 'color-cycle',
    colorCycleData: {},
    ...overrides,
  };
};

const createCanvas = (width = 16, height = 16): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const resolve = (layer: Layer | null | undefined) =>
  resolveColorCyclePresentation({
    layer,
    activeLayerId: 'cc-layer',
    projectWidth: 16,
    projectHeight: 16,
  });

describe('resolveColorCyclePresentation', () => {
  it('returns compatibility snapshots for cold restored layers with canvas image data', () => {
    const imageData = new ImageData(16, 16);
    const layer = createLayer({
      colorCycleData: {
        canvas: createCanvas(),
        canvasImageData: imageData,
        runtimeHydrationState: 'cold',
      },
    });

    expect(resolve(layer)).toEqual({
      kind: 'compatibility-snapshot',
      imageData,
      reason: 'cold',
    });
  });

  it('does not treat a cold runtime canvas as authoritative without a snapshot', () => {
    const layer = createLayer({
      colorCycleData: {
        canvas: createCanvas(),
        runtimeHydrationState: 'cold',
      },
    });

    expect(resolve(layer)).toEqual({
      kind: 'none',
      reason: 'missing-source',
    });
  });

  it('returns runtime surfaces for warm and active layers with valid canvases', () => {
    const warmCanvas = createCanvas();
    const activeCanvas = createCanvas();

    expect(resolve(createLayer({
      id: 'warm-layer',
      colorCycleData: {
        canvas: warmCanvas,
        runtimeHydrationState: 'warm',
      },
    }))).toEqual({
      kind: 'runtime-surface',
      canvas: warmCanvas,
      reason: 'warm',
    });

    expect(resolve(createLayer({
      colorCycleData: {
        canvas: activeCanvas,
        runtimeHydrationState: 'active',
      },
    }))).toEqual({
      kind: 'runtime-surface',
      canvas: activeCanvas,
      reason: 'active',
    });
  });

  it('keeps legacy layers without hydration state drawable from runtime canvas', () => {
    const canvas = createCanvas();
    const layer = createLayer({
      colorCycleData: {
        canvas,
      },
    });

    expect(resolve(layer)).toEqual({
      kind: 'runtime-surface',
      canvas,
      reason: 'active',
    });
  });

  it('returns none for hidden, non-cc, missing, and missing-source layers', () => {
    expect(resolve(null)).toEqual({ kind: 'none', reason: 'missing-layer' });

    expect(resolve(createLayer({ visible: false }))).toEqual({
      kind: 'none',
      reason: 'hidden',
    });

    expect(resolve(createLayer({
      layerType: 'normal',
      colorCycleData: undefined,
    }))).toEqual({
      kind: 'none',
      reason: 'not-color-cycle',
    });

    expect(resolve(createLayer({ colorCycleData: { runtimeHydrationState: 'warm' } }))).toEqual({
      kind: 'none',
      reason: 'missing-source',
    });
  });

  it('does not reject sparse off-center content by sampling pixels', () => {
    const canvas = createCanvas();
    const ctx = canvas.getContext('2d');
    ctx?.fillRect(15, 15, 1, 1);
    const layer = createLayer({
      colorCycleData: {
        canvas,
        runtimeHydrationState: 'warm',
      },
    });

    expect(resolve(layer)).toEqual({
      kind: 'runtime-surface',
      canvas,
      reason: 'warm',
    });
  });

  it('creates a drawable transfer canvas for compatibility snapshots', () => {
    const imageData = new ImageData(4, 4);
    imageData.data[3] = 255;
    const source = resolve(createLayer({
      colorCycleData: {
        canvasImageData: imageData,
        runtimeHydrationState: 'cold',
      },
    }));

    const canvas = getColorCyclePresentationCanvas(source);

    expect(canvas?.width).toBe(4);
    expect(canvas?.height).toBe(4);
  });

  it('applies enabled soft-edge masks to the drawable presentation canvas without mutating the source', () => {
    const sourceCanvas = createCanvas(2, 1);
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceCtx) {
      throw new Error('Expected source context');
    }
    sourceCtx.fillStyle = 'rgba(255, 0, 0, 1)';
    sourceCtx.fillRect(0, 0, 2, 1);

    const softEdgeMask = createCanvas(2, 1);
    const maskCtx = softEdgeMask.getContext('2d');
    if (!maskCtx) {
      throw new Error('Expected mask context');
    }
    maskCtx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    maskCtx.fillRect(0, 0, 1, 1);
    maskCtx.fillStyle = 'rgba(255, 255, 255, 1)';
    maskCtx.fillRect(1, 0, 1, 1);

    const layer = createLayer({
      colorCycleData: {
        canvas: sourceCanvas,
        runtimeHydrationState: 'active',
        softEdgeMask,
        softEdgeMaskEnabled: true,
        softEdgeMaskVersion: 1,
      },
    });
    const presentation = resolve(layer);

    const drawOperations: Array<GlobalCompositeOperation | undefined> = [];
    const drawImageSpy = jest
      .spyOn(CanvasRenderingContext2D.prototype, 'drawImage')
      .mockImplementation(function recordDrawOperation(this: CanvasRenderingContext2D) {
        drawOperations.push(this.globalCompositeOperation);
      });
    const maskedCanvas = getColorCyclePresentationCanvas(presentation, layer);
    const maskedCtx = maskedCanvas?.getContext(
      '2d',
      { willReadFrequently: true } as CanvasRenderingContext2DSettings,
    ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
    if (!maskedCtx) {
      throw new Error('Expected masked context');
    }

    const source = sourceCtx.getImageData(0, 0, 2, 1).data;
    expect(maskedCanvas).not.toBe(sourceCanvas);
    expect(drawImageSpy).toHaveBeenCalledWith(sourceCanvas, 0, 0);
    expect(drawImageSpy).toHaveBeenCalledWith(softEdgeMask, 0, 0);
    expect(drawOperations).toContain('destination-in');
    expect(source[3]).toBe(255);
    expect(source[7]).toBe(255);
    drawImageSpy.mockRestore();
  });

  it('leaves baked soft-edge masks out of the presentation canvas when disabled', () => {
    const sourceCanvas = createCanvas(1, 1);
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceCtx) {
      throw new Error('Expected source context');
    }
    sourceCtx.fillStyle = 'rgba(255, 0, 0, 1)';
    sourceCtx.fillRect(0, 0, 1, 1);

    const softEdgeMask = createCanvas(1, 1);
    const maskCtx = softEdgeMask.getContext('2d');
    if (!maskCtx) {
      throw new Error('Expected mask context');
    }
    maskCtx.clearRect(0, 0, 1, 1);

    const layer = createLayer({
      colorCycleData: {
        canvas: sourceCanvas,
        runtimeHydrationState: 'active',
        softEdgeMask,
        softEdgeMaskEnabled: false,
        softEdgeMaskVersion: 1,
      },
    });
    const presentation = resolve(layer);

    expect(getColorCyclePresentationCanvas(presentation, layer)).toBe(sourceCanvas);
  });
});
