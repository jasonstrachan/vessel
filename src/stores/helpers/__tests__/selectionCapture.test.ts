import type { Layer, Project } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const mockGetLayerColorCycleBrush = jest.fn<unknown | null, [string]>(() => null);

jest.mock('@/stores/colorCycleBrushManager', () => ({
  __esModule: true,
  getColorCycleStoreState: () => null,
  getColorCycleBrushManager: () => ({
    getLayerColorCycleBrush: mockGetLayerColorCycleBrush,
  }),
}));

import { captureSelectionBitmap } from '@/stores/helpers/selectionCapture';

const createProject = (): Project => ({
  id: 'project-selection-capture',
  name: 'Selection Capture',
  width: 4,
  height: 4,
  layers: [],
  backgroundColor: '#000000',
  createdAt: new Date(),
  updatedAt: new Date(),
  customBrushes: [],
});

const createOpaqueImage = (width: number, height: number): ImageData => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const base = i * 4;
    data[base] = 255;
    data[base + 1] = 255;
    data[base + 2] = 255;
    data[base + 3] = 255;
  }
  return new ImageData(data, width, height);
};

describe('selectionCapture color-cycle fallback', () => {
  afterEach(() => {
    mockGetLayerColorCycleBrush.mockReset();
    mockGetLayerColorCycleBrush.mockReturnValue(null);
  });

  it('captures color-cycle indices from persisted gradientIdBuffer when runtime brush is missing', () => {
    const gradientIds = new Uint8Array([
      0, 1, 2, 3,
      4, 5, 6, 7,
      8, 9, 10, 11,
      12, 13, 14, 15,
    ]);
    const layer: Layer = {
      id: 'layer-cc',
      name: 'CC',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: createOpaqueImage(4, 4),
      framebuffer: document.createElement('canvas'),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        gradientIdBuffer: gradientIds.buffer.slice(0),
        canvasWidth: 4,
        canvasHeight: 4,
      },
    };

    const capture = captureSelectionBitmap({
      selectionStart: { x: 1, y: 1 },
      selectionEnd: { x: 3, y: 2 },
      project: createProject(),
      layer,
      clearSource: false,
    });

    expect(capture).not.toBeNull();
    expect(capture?.bounds).toEqual({ x: 1, y: 1, width: 2, height: 1 });
    expect(Array.from(capture?.colorCycleIndices ?? [])).toEqual([5, 6]);
  });

  it('captures full CC payload from the live brush snapshot', () => {
    mockGetLayerColorCycleBrush.mockReturnValue({
      getLayerSnapshot: () => ({
        paintBuffer: Uint8Array.from([
          0, 1, 2, 3,
          4, 5, 6, 7,
          8, 9, 10, 11,
          12, 13, 14, 15,
        ]).buffer,
        gradientIdBuffer: Uint8Array.from([
          10, 11, 12, 13,
          14, 15, 16, 17,
          18, 19, 20, 21,
          22, 23, 24, 25,
        ]).buffer,
        gradientDefIdBuffer: Uint16Array.from([
          100, 101, 102, 103,
          104, 105, 106, 107,
          108, 109, 110, 111,
          112, 113, 114, 115,
        ]).buffer,
        speedBuffer: Uint8Array.from([
          30, 31, 32, 33,
          34, 35, 36, 37,
          38, 39, 40, 41,
          42, 43, 44, 45,
        ]).buffer,
        flowBuffer: Uint8Array.from([
          50, 51, 52, 53,
          54, 55, 56, 57,
          58, 59, 60, 61,
          62, 63, 64, 65,
        ]).buffer,
      }),
      getCanvas: () => ({ width: 4, height: 4 }),
    });

    const layer: Layer = {
      id: 'layer-cc-live',
      name: 'CC Live',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: createOpaqueImage(4, 4),
      framebuffer: document.createElement('canvas'),
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        canvasWidth: 4,
        canvasHeight: 4,
      },
    };

    const capture = captureSelectionBitmap({
      selectionStart: { x: 1, y: 1 },
      selectionEnd: { x: 3, y: 3 },
      project: createProject(),
      layer,
      clearSource: false,
    });

    expect(capture).not.toBeNull();
    expect(Array.from(capture?.colorCycleIndices ?? [])).toEqual([5, 6, 9, 10]);
    expect(Array.from(capture?.colorCycleGradientIds ?? [])).toEqual([15, 16, 19, 20]);
    expect(Array.from(capture?.colorCycleGradientDefIds ?? [])).toEqual([105, 106, 109, 110]);
    expect(Array.from(capture?.colorCycleSpeed ?? [])).toEqual([35, 36, 39, 40]);
    expect(Array.from(capture?.colorCycleFlow ?? [])).toEqual([55, 56, 59, 60]);
  });
});
