import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { computeLayerPercentOffset, computeLayerContentMetrics } from '@/utils/layerMetrics';
import { deriveAutoPercentOffset } from '@/utils/alignment/alignFitResolver';
import type { Layer, Project } from '@/types';

const createImageData = (width: number, height: number): ImageData => {
  if (typeof ImageData !== 'undefined') {
    return new ImageData(width, height);
  }

  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4)
  } as unknown as ImageData;
};

const EPS = 1e-4;

const expectClose = (actual: number, expected: number, epsilon = EPS) => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(epsilon);
};

describe('layerMetrics', () => {
  it('computes percent offset from image data content bounds', () => {
    const width = 10;
    const height = 8;
    const imageData = createImageData(width, height);

    // Activate a single pixel at (2, 3) to create non-zero alpha content
    const x = 2;
    const y = 3;
    imageData.data[((y * width) + x) * 4 + 3] = 255;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const layer: Layer = {
      id: 'layer-1',
      name: 'Layer 1',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal'
    };

    const project: Project = {
      id: 'project-1',
      name: 'Test Project',
      width,
      height,
      layers: [layer],
      backgroundColor: 'transparent',
      createdAt: new Date(),
      updatedAt: new Date(),
      customBrushes: []
    };

    const offset = computeLayerPercentOffset(layer, project);
    const metrics = computeLayerContentMetrics(layer, project);
    const expected = deriveAutoPercentOffset({
      x: metrics.contentBounds.x,
      y: metrics.contentBounds.y,
      width: metrics.contentBounds.width,
      height: metrics.contentBounds.height,
    }, {
      width: project.width,
      height: project.height,
    });

    expectClose(offset.x, expected.x);
    expectClose(offset.y, expected.y);
  });

  it('accounts for document frame when deriving auto percent offsets', () => {
    const width = 20;
    const height = 10;
    const imageData = createImageData(width, height);
    const pixelX = 5;
    const pixelY = 6;
    imageData.data[((pixelY * width) + pixelX) * 4 + 3] = 255;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const frame = { x: 40, y: 30 };
    const bounds = { x: frame.x, y: frame.y, width, height } as const;

    const layer: Layer & { frame: { x: number; y: number }; bounds: typeof bounds } = {
      id: 'layer-doc',
      name: 'Layer Doc',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
      frame,
      bounds
    };

    const project: Project = {
      id: 'project-doc',
      name: 'Doc Project',
      width: 200,
      height: 150,
      layers: [layer],
      backgroundColor: 'transparent',
      createdAt: new Date(),
      updatedAt: new Date(),
      customBrushes: []
    };

    const percent = computeLayerPercentOffset(layer, project);

    const expected = deriveAutoPercentOffset(bounds, {
      width: project.width,
      height: project.height
    });

    expectClose(percent.x, expected.x);
    expectClose(percent.y, expected.y);
  });
});
