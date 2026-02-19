import type { Layer, Project } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

jest.mock('@/stores/colorCycleBrushManager', () => ({
  __esModule: true,
  getColorCycleBrushManager: () => ({
    getLayerColorCycleBrush: () => null,
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
});
