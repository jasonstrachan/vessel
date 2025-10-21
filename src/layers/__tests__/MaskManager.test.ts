import { MaskManager, type MaskManagerDeps } from '@/layers/MaskManager';
import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createLayer = (id: string, width: number, height: number): Layer => {
  const framebuffer = document.createElement('canvas');
  framebuffer.width = width;
  framebuffer.height = height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  return {
    id,
    name: `Layer ${id}`,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData: null,
    framebuffer,
    alignment: createDefaultLayerAlignment(),
    layerType: 'color-cycle',
    colorCycleData: {
      canvas,
      eraseMaskVersion: 0
    }
  };
};

const setupManager = (layer: Layer): { manager: MaskManager; layers: Map<string, Layer> } => {
  const layers = new Map<string, Layer>();
  layers.set(layer.id, layer);

  const deps: MaskManagerDeps = {
    getLayer: (layerId) => layers.get(layerId),
    updateLayer: (layerId, patch) => {
      const current = layers.get(layerId);
      if (!current) return;
      const nextColorCycleData = patch.colorCycleData
        ? {
            ...(current.colorCycleData ?? {}),
            ...patch.colorCycleData
          }
        : current.colorCycleData;
      layers.set(layerId, {
        ...current,
        ...patch,
        colorCycleData: nextColorCycleData
      });
    },
    getProjectSize: () => ({ width: 100, height: 80 })
  };

  return { manager: new MaskManager(deps), layers };
};

describe('MaskManager', () => {
  it('creates a mask when none exists', () => {
    const baseLayer = createLayer('layer-a', 120, 90);
    delete baseLayer.colorCycleData?.eraseMask;
    const { manager, layers } = setupManager(baseLayer);

    const mask = manager.getMask(baseLayer.id);
    expect(mask).toBeInstanceOf(HTMLCanvasElement);
    expect(mask.width).toBe(baseLayer.colorCycleData?.canvas?.width);
    expect(mask.height).toBe(baseLayer.colorCycleData?.canvas?.height);

    const updated = layers.get(baseLayer.id);
    expect(updated?.colorCycleData?.eraseMask).toBe(mask);
    expect(updated?.colorCycleData?.eraseMaskVersion).toBe(0);
  });

  it('resizes mask and preserves content', () => {
    const layer = createLayer('layer-b', 60, 60);
    const initialMask = document.createElement('canvas');
    initialMask.width = 50;
    initialMask.height = 50;
    const initialCtx = initialMask.getContext('2d');
    initialCtx?.fillRect(10, 10, 10, 10);
    layer.colorCycleData = {
      ...layer.colorCycleData,
      eraseMask: initialMask,
      eraseMaskVersion: 0
    };

    const { manager, layers } = setupManager(layer);
    const resizedMask = manager.resize(layer.id, 80, 80);

    expect(resizedMask.width).toBe(80);
    expect(resizedMask.height).toBe(80);

    expect(resizedMask).not.toBe(initialMask);
    const updatedLayer = layers.get(layer.id);
    expect(updatedLayer?.colorCycleData?.eraseMaskVersion).toBe(1);
  });
});
