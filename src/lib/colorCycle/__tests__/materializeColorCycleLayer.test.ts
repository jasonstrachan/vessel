import {
  classifyColorCycleCanonicalContent,
  materializeColorCycleLayer,
  materializeRestoredColorCycleSurface,
  resolveColorCycleRuntimeSurface,
} from '@/lib/colorCycle/materializeColorCycleLayer';
import type { ColorCycleLayerDocumentState } from '@/lib/colorCycle/documentState';
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

const createDocumentState = (
  paint: number[],
  hasContent: boolean,
): ColorCycleLayerDocumentState => ({
  layerId: 'cc-layer',
  width: 2,
  height: 2,
  paintBuffer: new Uint8Array(paint).buffer,
  hasContent,
  sources: {
    brushStateSnapshot: true,
    topLevelBuffers: false,
    legacyStateRefs: false,
  },
});

const writePixel = (
  canvas: HTMLCanvasElement,
  rgba: [number, number, number, number],
): void => {
  const imageData = new ImageData(canvas.width, canvas.height);
  imageData.data.set(rgba, 0);
  canvas.getContext('2d')?.putImageData(imageData, 0, 0);
};

const readFirstPixel = (canvas: HTMLCanvasElement): number[] => (
  Array.from(canvas.getContext('2d')?.getImageData(0, 0, 1, 1).data ?? [])
);

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

  it('does not copy compatibility snapshot pixels into a blank runtime surface', () => {
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
      getColorCycleDerivedSurface: () => null,
      renderDirectToCanvas: jest.fn((target: HTMLCanvasElement) => {
        target.getContext('2d')?.clearRect(0, 0, target.width, target.height);
      }),
    };

    const materialized = materializeRestoredColorCycleSurface(
      layer,
      brush,
      { kind: 'populated' },
    );
    const pixel = canvas.getContext('2d')?.getImageData(0, 0, 1, 1).data;

    expect(materialized).toBe(false);
    expect(pixel?.[0]).toBe(0);
    expect(pixel?.[3]).toBe(0);
    expect(layer.colorCycleData?.hasContent).toBeUndefined();
  });

  it('does not synthesize white pixels from a paint snapshot when runtime render is blank', () => {
    const canvas = createCanvas(2, 2);
    const layer = createColorCycleLayer(canvas);
    const brush = {
      getColorCycleDerivedSurface: () => null,
      getLayerSnapshot: jest.fn(() => ({
        paintBuffer: new Uint8Array([1, 1, 1, 1]).buffer,
        hasContent: true,
      })),
      renderDirectToCanvas: jest.fn((target: HTMLCanvasElement) => {
        target.getContext('2d')?.clearRect(0, 0, target.width, target.height);
      }),
    };

    const materialized = materializeRestoredColorCycleSurface(
      layer,
      brush,
      { kind: 'populated' },
    );
    const pixel = canvas.getContext('2d')?.getImageData(0, 0, 1, 1).data;

    expect(materialized).toBe(false);
    expect(pixel?.[0]).toBe(0);
    expect(pixel?.[3]).toBe(0);
    expect(layer.colorCycleData?.hasContent).toBeUndefined();
  });

  it('accepts a valid transparent populated render without blanking the published canvas', () => {
    const canvas = createCanvas(2, 2);
    writePixel(canvas, [180, 40, 20, 255]);
    const layer = createColorCycleLayer(canvas);

    const materialized = materializeRestoredColorCycleSurface(layer, {
      getColorCycleDerivedSurface: () => ({}),
      renderDirectToCanvas: (target) => {
        target.getContext('2d')?.clearRect(0, 0, target.width, target.height);
      },
    }, { kind: 'populated' });

    expect(materialized).toBe(true);
    expect(readFirstPixel(canvas)).toEqual([180, 40, 20, 255]);
    expect(layer.colorCycleData?.hasContent).toBe(true);
  });

  it('preserves the published canvas when restored rendering throws', () => {
    const canvas = createCanvas(2, 2);
    writePixel(canvas, [90, 120, 150, 255]);
    const layer = createColorCycleLayer(canvas);

    const materialized = materializeRestoredColorCycleSurface(layer, {
      renderDirectToCanvas: () => {
        throw new Error('render failed');
      },
    }, { kind: 'populated' });

    expect(materialized).toBe(false);
    expect(readFirstPixel(canvas)).toEqual([90, 120, 150, 255]);
  });

  it('commits a visible candidate only after rendering into scratch', () => {
    const canvas = createCanvas(2, 2);
    writePixel(canvas, [200, 20, 20, 255]);
    const layer = createColorCycleLayer(canvas);
    let renderTarget: HTMLCanvasElement | null = null;

    const materialized = materializeRestoredColorCycleSurface(layer, {
      renderDirectToCanvas: (target) => {
        renderTarget = target;
        writePixel(target, [20, 200, 60, 255]);
      },
    }, classifyColorCycleCanonicalContent(createDocumentState([1, 0, 0, 0], false)));

    expect(materialized).toBe(true);
    expect(renderTarget).not.toBe(canvas);
    expect(readFirstPixel(canvas)).toEqual([20, 200, 60, 255]);
  });

  it('allows a canonically empty layer to commit a blank candidate', () => {
    const canvas = createCanvas(2, 2);
    writePixel(canvas, [30, 60, 90, 255]);
    const layer = createColorCycleLayer(canvas);
    layer.colorCycleData!.hasContent = true;

    const materialized = materializeRestoredColorCycleSurface(layer, {
      renderDirectToCanvas: (target) => {
        target.getContext('2d')?.clearRect(0, 0, target.width, target.height);
      },
    }, classifyColorCycleCanonicalContent(createDocumentState([0, 0, 0, 0], false)));

    expect(materialized).toBe(true);
    expect(readFirstPixel(canvas)).toEqual([0, 0, 0, 0]);
    expect(layer.colorCycleData?.hasContent).toBe(false);
  });

  it.each([
    ['missing paint', { ...createDocumentState([0, 0, 0, 0], false), paintBuffer: undefined }],
    ['contradictory content marker', createDocumentState([0, 0, 0, 0], true)],
  ])('fails closed for %s canonical state', (_label, state) => {
    const canvas = createCanvas(2, 2);
    writePixel(canvas, [12, 34, 56, 255]);
    const layer = createColorCycleLayer(canvas);
    const renderDirectToCanvas = jest.fn((target: HTMLCanvasElement) => {
      writePixel(target, [200, 200, 200, 255]);
    });

    const materialized = materializeRestoredColorCycleSurface(
      layer, { renderDirectToCanvas }, classifyColorCycleCanonicalContent(state),
    );

    expect(materialized).toBe(false);
    expect(renderDirectToCanvas).not.toHaveBeenCalled();
    expect(readFirstPixel(canvas)).toEqual([12, 34, 56, 255]);
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
