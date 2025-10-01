import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { computeLayerPercentOffset } from '@/utils/layerMetrics';
import { deriveAutoPercentOffset, type LayerBounds } from '@/utils/alignment/alignFitResolver';
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

    expect(offset.x).toBeCloseTo((2 / 9) * 100, 5);
    expect(offset.y).toBeCloseTo((3 / 7) * 100, 5);
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
    const bounds = { x: frame.x, y: frame.y, width, height, anchor: 'top-left' } as const;

    const layer: Layer & { frame: { x: number; y: number }; bounds: LayerBounds } = {
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

    const expected = deriveAutoPercentOffset(
      {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        anchor: bounds.anchor
      },
      { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
      { width: project.width, height: project.height }
    );

    expect(percent.x).toBeCloseTo(expected.x, 5);
    expect(percent.y).toBeCloseTo(expected.y, 5);
  });
});
