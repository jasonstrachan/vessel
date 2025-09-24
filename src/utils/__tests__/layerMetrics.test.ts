import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { computeLayerPercentOffset } from '@/utils/layerMetrics';
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

    expect(offset.x).toBeCloseTo(20, 5);
    expect(offset.y).toBeCloseTo(37.5, 5);
  });
});
