import {
  buildCapturedColorCycleDataFromImage,
  captureBrushFromCanvas,
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
