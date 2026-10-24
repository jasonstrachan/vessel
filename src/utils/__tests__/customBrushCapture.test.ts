import {
  buildCapturedColorCycleDataFromImage,
  captureBrushFromCanvas,
  captureBrushFromPath,
  captureColorCycleDataFromLayer,
  MAX_CUSTOM_BRUSH_CAPTURE_PIXELS,
  selectionToCaptureBounds,
} from '@/utils/customBrushCapture';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { attachLegacyColorCycleTopLevelBuffers } from '@/lib/colorCycle/document';

const getDocument = jest.fn();

jest.mock('@/stores/colorCycleBrushManager', () => ({
  __esModule: true,
  setLayerIdGetter: jest.fn(),
  setColorCycleStoreStateGetter: jest.fn(),
  getColorCycleBrushManager: () => ({
    getDocument: (...args: unknown[]) => getDocument(...args),
  }),
}));

const createLayer = (): Layer => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = 2;
  framebuffer.height = 2;

  return {
    id: 'cc-layer',
    name: 'Color Cycle',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData: null,
    framebuffer,
    alignment: createDefaultLayerAlignment(),
    layerType: 'color-cycle',
    colorCycleData: attachLegacyColorCycleTopLevelBuffers({
      canvasWidth: 2,
      canvasHeight: 2,
      gradient: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      brushSpeed: 0.2,
    }, {
      gradientIdBuffer: new Uint8Array([9, 9, 9, 9]).buffer,
    }),
  };
};

const createDocumentWithPaint = (paintBuffer: ArrayBuffer) => ({
  residency: 'resident',
  read: () => ({
    snapshot: {
      paintBuffer,
      hasContent: paintBuffer.byteLength > 0,
    },
    version: 1,
  }),
});

describe('captureColorCycleDataFromLayer', () => {
  beforeEach(() => {
    getDocument.mockReset();
  });

  it('uses the resident document paintBuffer as the indexed tip map', () => {
    getDocument.mockReturnValue(
      createDocumentWithPaint(new Uint8Array([1, 2, 3, 4]).buffer)
    );

    const capture = captureColorCycleDataFromLayer({
      activeLayer: createLayer(),
      sampleAllLayers: false,
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      captureResult: {
        imageData: new ImageData(
          new Uint8ClampedArray([
            255, 255, 255, 255,
            255, 255, 255, 255,
            255, 255, 255, 255,
            255, 255, 255, 255,
          ]),
          2,
          2
        ),
        width: 2,
        height: 2,
        naturalWidth: 2,
        naturalHeight: 2,
        maxDimension: 2,
      },
    });

    expect(capture?.schemaVersion).toBe(3);
    expect(capture?.payloadKind).toBe('indexed-tip');
    expect(Array.from(capture?.paintIndexMap ?? [])).toEqual([1, 2, 3, 4]);
  });

  it.each([
    { name: 'in-bounds rectangle', path: false, bounds: { x: 1, y: 1, width: 3, height: 3 }, size: [3, 3], indices: [8, 9, 10, 14, 15, 16, 20, 21, 22] },
    { name: 'bottom-clipped rectangle', path: false, bounds: { x: 1, y: 3, width: 3, height: 4 }, size: [3, 2], indices: [20, 21, 22, 26, 27, 28] },
    { name: 'right-and-bottom-clipped freehand', path: true, bounds: { x: 4, y: 3, width: 4, height: 4 }, size: [2, 2], indices: [23, 24, 29, 30] },
    { name: 'negative-origin freehand', path: true, bounds: { x: -2, y: -1, width: 5, height: 4 }, size: [3, 3], indices: [1, 2, 3, 7, 8, 9, 13, 14, 15] },
  ])('aligns canonical indices and alpha with the actual RGBA crop for $name', ({ path, bounds, size, indices }) => {
    const rasterGlobal = globalThis as typeof globalThis & { __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean };
    const previousRaster = rasterGlobal.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
    rasterGlobal.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true;
    try {
      const layer = createLayer();
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = 6;
      sourceCanvas.height = 5;
      layer.framebuffer = sourceCanvas;
      if (!layer.colorCycleData) throw new Error('Expected CC metadata');
      layer.colorCycleData.canvasWidth = 6;
      layer.colorCycleData.canvasHeight = 5;
      const paint = Uint8Array.from({ length: 30 }, (_, i) => i + 1);
      const sourcePixels = new Uint8ClampedArray(30 * 4);
      const alphaForIndex = (index: number) => [255, 128, 0, 255][index % 4];
      paint.forEach((index, i) => sourcePixels.set([index, 255 - index, index * 2, alphaForIndex(index)], i * 4));
      const context = sourceCanvas.getContext('2d');
      if (!context) throw new Error('Expected source context');
      context.putImageData(new ImageData(sourcePixels, 6, 5), 0, 0);
      getDocument.mockReturnValue(createDocumentWithPaint(paint.buffer));
      const options = { generateThumbnail: false };
      const captureResult = path
        ? captureBrushFromPath(sourceCanvas, {
            bounds,
            points: [
              { x: bounds.x, y: bounds.y },
              { x: bounds.x + bounds.width, y: bounds.y },
              { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
              { x: bounds.x, y: bounds.y + bounds.height },
            ],
          }, options)
        : captureBrushFromCanvas(sourceCanvas, bounds, options);
      if (!captureResult) throw new Error('Expected actual clipped raster capture');
      const expectedPixels = indices.flatMap(index => [index, 255 - index, index * 2, alphaForIndex(index)]);
      expect([captureResult.width, captureResult.height]).toEqual(size);
      expect(Array.from(captureResult.imageData.data)).toEqual(expectedPixels);
      const capture = captureColorCycleDataFromLayer({ activeLayer: layer, sampleAllLayers: false, bounds, captureResult });
      expect(capture?.paintIndexMap).toEqual(Uint16Array.from(indices));
      expect([capture?.mapWidth, capture?.mapHeight]).toEqual(size);
      expect(capture?.alphaMask).toEqual(Uint8Array.from(indices.map(alphaForIndex)));
      expect(Array.from(paint)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
      expect(context.getImageData(0, 0, 6, 5).data).toEqual(sourcePixels);
    } finally {
      rasterGlobal.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = previousRaster;
    }
  });

  it('fails closed when the canonical crop dimensions cannot match the captured RGBA', () => {
    getDocument.mockReturnValue(createDocumentWithPaint(new Uint8Array([1, 2, 3, 4]).buffer));
    const capture = captureColorCycleDataFromLayer({
      activeLayer: createLayer(),
      sampleAllLayers: false,
      bounds: { x: 0, y: 0, width: 3, height: 2 },
      captureResult: {
        imageData: new ImageData(3, 2),
        width: 3,
        height: 2,
        naturalWidth: 3,
        naturalHeight: 2,
        maxDimension: 3,
      },
    });
    expect(capture).toBeUndefined();
  });

  it('fails closed when the resident document paintBuffer is missing', () => {
    getDocument.mockReturnValue(createDocumentWithPaint(new ArrayBuffer(0)));

    const capture = captureColorCycleDataFromLayer({
      activeLayer: createLayer(),
      sampleAllLayers: false,
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      captureResult: {
        imageData: new ImageData(
          new Uint8ClampedArray([
            255, 255, 255, 255,
            255, 255, 255, 255,
            255, 255, 255, 255,
            255, 255, 255, 255,
          ]),
          2,
          2
        ),
        width: 2,
        height: 2,
        naturalWidth: 2,
        naturalHeight: 2,
        maxDimension: 2,
      },
    });

    expect(capture).toBeUndefined();
  });

  it('fails closed when the color-cycle document is cold', () => {
    getDocument.mockReturnValue({
      ...createDocumentWithPaint(new Uint8Array([1, 2, 3, 4]).buffer),
      residency: 'cold',
    });

    const capture = captureColorCycleDataFromLayer({
      activeLayer: createLayer(),
      sampleAllLayers: false,
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      captureResult: {
        imageData: new ImageData(new Uint8ClampedArray(16), 2, 2),
        width: 2,
        height: 2,
        naturalWidth: 2,
        naturalHeight: 2,
        maxDimension: 2,
      },
    });

    expect(capture).toBeUndefined();
  });

  it('captures gradient from active slot palette when defs are present', () => {
    getDocument.mockReturnValue(
      createDocumentWithPaint(new Uint8Array([1, 2, 3, 4]).buffer)
    );

    const layer = createLayer();
    if (!layer.colorCycleData) {
      throw new Error('Expected colorCycleData');
    }
    layer.colorCycleData.gradient = [{ position: 0, color: '#111111' }, { position: 1, color: '#222222' }];
    layer.colorCycleData.gradientDefs = [{ id: 'g-main', currentSlot: 7 }];
    layer.colorCycleData.activeGradientId = 'g-main';
    layer.colorCycleData.paintSlot = 7;
    layer.colorCycleData.slotPalettes = [
      {
        slot: 7,
        stops: [{ position: 0, color: '#00ff00' }, { position: 1, color: '#00ff00' }],
      },
    ];

    const capture = captureColorCycleDataFromLayer({
      activeLayer: layer,
      sampleAllLayers: false,
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      captureResult: {
        imageData: new ImageData(new Uint8ClampedArray(2 * 2 * 4), 2, 2),
        width: 2,
        height: 2,
        naturalWidth: 2,
        naturalHeight: 2,
        maxDimension: 2,
      },
    });

    expect(capture?.gradient).toEqual([
      { position: 0, color: '#00ff00' },
      { position: 1, color: '#00ff00' },
    ]);
  });
});

describe('buildCapturedColorCycleDataFromImage', () => {
  it('preserves captured tip colors as a palette and per-pixel index map', () => {
    const capture = buildCapturedColorCycleDataFromImage({
      imageData: new ImageData(
        new Uint8ClampedArray([
          255, 0, 0, 255,
          0, 255, 0, 255,
          255, 0, 0, 128,
          0, 0, 0, 0,
        ]),
        2,
        2
      ),
      width: 2,
      height: 2,
      naturalWidth: 2,
      naturalHeight: 2,
      maxDimension: 2,
    });

    expect(capture.capturedColors).toEqual(['#ff0000', '#00ff00']);
    expect(Array.from(capture.indexMap ?? [])).toEqual([0, 1, 0, 0]);
    expect(Array.from(capture.alphaMask ?? [])).toEqual([255, 255, 128, 0]);
  });
});

describe('selectionToCaptureBounds', () => {
  it('expands the trailing edge to preserve the full selected pixel area', () => {
    expect(
      selectionToCaptureBounds({ x: 10.2, y: 20.1 }, { x: 14.9, y: 25.9 })
    ).toEqual({
      x: 10,
      y: 20,
      width: 5,
      height: 6,
    });
  });

  it('is symmetric regardless of drag direction', () => {
    expect(
      selectionToCaptureBounds({ x: 14.9, y: 25.9 }, { x: 10.2, y: 20.1 })
    ).toEqual({
      x: 10,
      y: 20,
      width: 5,
      height: 6,
    });
  });
});

describe('captureBrushFromCanvas size guard', () => {
  it('rejects capture areas above the allocation ceiling', () => {
    const edge = Math.floor(Math.sqrt(MAX_CUSTOM_BRUSH_CAPTURE_PIXELS)) + 1;
    const sourceCanvas = { width: edge, height: edge } as HTMLCanvasElement;

    expect(captureBrushFromCanvas(sourceCanvas, {
      x: 0,
      y: 0,
      width: edge,
      height: edge,
    })).toBeNull();
  });
});
