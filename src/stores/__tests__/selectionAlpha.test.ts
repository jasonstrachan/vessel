import { TextDecoder, TextEncoder } from 'util';

(global as unknown as { TextEncoder?: typeof TextEncoder }).TextEncoder = TextEncoder;
(global as unknown as { TextDecoder?: typeof TextDecoder }).TextDecoder = TextDecoder;

import { useAppStore } from '@/stores/useAppStore';
import type { Layer, Project } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createLayerWithAlpha = (id: string, width: number, height: number, opaquePixels: Array<{ x: number; y: number }>): Layer => {
  const data = new Uint8ClampedArray(width * height * 4);
  opaquePixels.forEach(({ x, y }) => {
    const index = (y * width + x) * 4;
    data[index] = 10;
    data[index + 1] = 20;
    data[index + 2] = 30;
    data[index + 3] = 255;
  });

  const imageData = new ImageData(data, width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  return {
    id,
    name: 'Alpha Layer',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'normal',
  };
};

const createProject = (layer: Layer): Project => ({
  id: 'project-alpha',
  name: 'Alpha Project',
  width: layer.imageData?.width ?? 1,
  height: layer.imageData?.height ?? 1,
  layers: [layer],
  backgroundColor: '#000',
  createdAt: new Date(),
  updatedAt: new Date(),
  customBrushes: [],
});

describe('selectLayerAlpha', () => {
  afterEach(() => {
    useAppStore.setState({
      project: null,
      layers: [],
      activeLayerId: null,
      selectionStart: null,
      selectionEnd: null,
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
    });
  });

  it('selects the bounding box of non-transparent pixels and stores a mask', () => {
    const layer = createLayerWithAlpha('layer-1', 5, 4, [
      { x: 2, y: 1 },
      { x: 4, y: 3 },
    ]);
    const project = createProject(layer);

    useAppStore.setState({
      project,
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: null,
      selectionEnd: null,
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
    });

    useAppStore.getState().selectLayerAlpha(layer.id);

    expect(useAppStore.getState().selectionStart).toEqual({ x: 2, y: 1 });
    expect(useAppStore.getState().selectionEnd).toEqual({ x: 5, y: 4 });
    const mask = useAppStore.getState().selectionMask;
    expect(mask).not.toBeNull();
    expect(mask?.width).toBe(3);
    expect(mask?.height).toBe(3);
  });

  it('clears selection when the layer is fully transparent', () => {
    const layer = createLayerWithAlpha('layer-empty', 3, 3, []);
    const project = createProject(layer);

    useAppStore.setState({
      project,
      layers: [layer],
      activeLayerId: layer.id,
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 1, y: 1 },
      selectionMask: new ImageData(1, 1),
      selectionMaskBounds: { x: 0, y: 0, width: 1, height: 1 },
      selectionMaskLayerId: layer.id,
    });

    useAppStore.getState().selectLayerAlpha(layer.id);

    expect(useAppStore.getState().selectionStart).toBeNull();
    expect(useAppStore.getState().selectionEnd).toBeNull();
    expect(useAppStore.getState().selectionMask).toBeNull();
  });
});
