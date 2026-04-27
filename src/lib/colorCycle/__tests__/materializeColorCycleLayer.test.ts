import {
  materializeColorCycleLayer,
  materializeRestoredColorCycleSurface,
  resolveColorCycleRuntimeSurface,
} from '@/lib/colorCycle/materializeColorCycleLayer';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createColorCycleLayer = (canvas: HTMLCanvasElement): Layer => ({
  id: 'cc-layer',
  name: 'CC Layer',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  order: 0,
  imageData: null,
  framebuffer: canvas,
  alignment: createDefaultLayerAlignment(),
  layerType: 'color-cycle',
  colorCycleData: {
    canvas,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    runtimeHydrationState: 'cold',
    deferredRuntimeRestore: true,
  },
});

const createCanvas = (width = 4, height = 4): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

describe('materializeColorCycleLayer', () => {
  it('hydrates, marks target state, and returns the restored runtime surface', async () => {
    const canvas = createCanvas();
    const layer = createColorCycleLayer(canvas);
    layer.colorCycleData = {
      ...layer.colorCycleData,
      brushState: {
        layers: [{
          layerId: layer.id,
          strokeData: {
            paintBuffer: new Uint8Array(canvas.width * canvas.height).fill(1).buffer,
            hasContent: true,
          },
        }],
      },
    };
    const brush = {
      renderDirectToCanvas: jest.fn(),
    };
    const hydrateRuntime = jest.fn(async () => undefined);
    const setHydrationState = jest.fn((colorCycleData, target) => ({
      ...colorCycleData,
      runtimeHydrationState: target,
      deferredRuntimeRestore: false,
    }));
    const restoreRuntime = jest.fn(async () => ({
      brush,
      materialized: true,
    }));

    const result = await materializeColorCycleLayer({
      layer,
      target: 'active',
      hydrateRuntime,
      setHydrationState,
      restoreRuntime,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect(result.state).toBe('active');
    expect(result.layer).toBe(layer);
    expect(result.documentState.layerId).toBe(layer.id);
    expect(result.documentState.width).toBe(canvas.width);
    expect(result.documentState.height).toBe(canvas.height);
    expect(result.brush).toBe(brush);
    expect(result.surface).toBe(canvas);
    expect(result.materialized).toBe(true);
    expect(hydrateRuntime).toHaveBeenCalledWith(layer);
    expect(setHydrationState).toHaveBeenCalledWith(expect.any(Object), 'active');
    expect(restoreRuntime).toHaveBeenCalledWith(layer, expect.objectContaining({
      layerId: layer.id,
      width: canvas.width,
      height: canvas.height,
    }));
    expect(layer.colorCycleData?.runtimeHydrationState).toBe('active');
    expect(layer.colorCycleData?.deferredRuntimeRestore).toBe(false);
  });

  it('returns a structured failure for non-color-cycle layers', async () => {
    const canvas = createCanvas();
    const layer: Layer = {
      ...createColorCycleLayer(canvas),
      layerType: 'normal',
      colorCycleData: undefined,
    };

    const result = await materializeColorCycleLayer({
      layer,
      target: 'warm',
      hydrateRuntime: jest.fn(),
      setHydrationState: jest.fn(),
      restoreRuntime: jest.fn(),
    });

    expect(result).toEqual({
      ok: false,
      state: 'failed',
      layer,
      reason: 'not-color-cycle',
    });
  });

  it('returns a structured failure when document state dimensions are invalid', async () => {
    const canvas = createCanvas();
    const layer = createColorCycleLayer(canvas);
    layer.colorCycleData = {
      ...layer.colorCycleData,
      brushState: {
        layers: [{
          layerId: layer.id,
          strokeData: {
            paintBuffer: new ArrayBuffer(3),
          },
        }],
      },
    };

    const result = await materializeColorCycleLayer({
      layer,
      target: 'warm',
      hydrateRuntime: jest.fn(async () => undefined),
      setHydrationState: jest.fn((colorCycleData) => colorCycleData),
      restoreRuntime: jest.fn(async () => ({ brush: null })),
    });

    expect(result).toEqual({
      ok: false,
      state: 'failed',
      layer,
      reason: 'paintBuffer byteLength 3 does not match 16 for 4x4',
    });
  });

  it('returns a structured failure when canonical paint is missing', async () => {
    const canvas = createCanvas();
    const layer = createColorCycleLayer(canvas);

    const result = await materializeColorCycleLayer({
      layer,
      target: 'warm',
      hydrateRuntime: jest.fn(async () => undefined),
      setHydrationState: jest.fn((colorCycleData) => colorCycleData),
      restoreRuntime: jest.fn(async () => ({ brush: null })),
    });

    expect(result).toEqual({
      ok: false,
      state: 'failed',
      layer,
      reason: 'missing-paint-buffer',
    });
  });

  it('keeps compatibility snapshot pixels when restored runtime render is blank', () => {
    const canvas = createCanvas(2, 2);
    const imageData = new ImageData(2, 2);
    imageData.data[0] = 200;
    imageData.data[3] = 255;
    const layer = createColorCycleLayer(canvas);
    layer.colorCycleData = {
      ...layer.colorCycleData,
      canvasImageData: imageData,
    };
    const brush = {
      renderDirectToCanvas: jest.fn((target: HTMLCanvasElement) => {
        target.getContext('2d')?.clearRect(0, 0, target.width, target.height);
      }),
    };

    const materialized = materializeRestoredColorCycleSurface(layer, brush);
    const pixel = canvas.getContext('2d')?.getImageData(0, 0, 1, 1).data;

    expect(materialized).toBe(false);
    expect(pixel?.[0]).toBe(200);
    expect(pixel?.[3]).toBe(255);
    expect(layer.colorCycleData?.hasContent).toBe(true);
  });

  it('publishes the live runtime surface through the shared ownership helper', () => {
    const storedCanvas = createCanvas(2, 2);
    const liveCanvas = createCanvas(3, 3);
    const layer = createColorCycleLayer(storedCanvas);
    const publishSurface = jest.fn();

    const surface = resolveColorCycleRuntimeSurface({
      layer,
      brush: {
        getCanvas: () => liveCanvas,
      },
      publishSurface,
    });

    expect(surface).toBe(liveCanvas);
    expect(publishSurface).toHaveBeenCalledWith(liveCanvas);
  });
});
