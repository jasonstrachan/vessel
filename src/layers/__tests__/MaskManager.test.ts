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

const setupManager = (layer: Layer): {
  manager: MaskManager;
  layers: Map<string, Layer>;
  updateLayer: jest.Mock;
} => {
  const layers = new Map<string, Layer>();
  layers.set(layer.id, layer);
  const updateLayer = jest.fn((layerId: string, patch: Partial<Layer>) => {
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
  });

  const deps: MaskManagerDeps = {
    getLayer: (layerId) => layers.get(layerId),
    updateLayer,
    getProjectSize: () => ({ width: 100, height: 80 })
  };

  return { manager: new MaskManager(deps), layers, updateLayer };
};

describe('MaskManager', () => {
  const getAlpha = (canvas: HTMLCanvasElement, x: number, y: number): number => {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Missing canvas context');
    }
    return ctx.getImageData(x, y, 1, 1).data[3];
  };

  it('creates a mask when none exists', () => {
    const baseLayer = createLayer('layer-a', 120, 90);
    delete baseLayer.colorCycleData?.eraseMask;
    const { manager, layers, updateLayer } = setupManager(baseLayer);

    const mask = manager.getMask(baseLayer.id);
    expect(mask).toBeInstanceOf(HTMLCanvasElement);
    expect(mask.width).toBe(baseLayer.colorCycleData?.canvas?.width);
    expect(mask.height).toBe(baseLayer.colorCycleData?.canvas?.height);

    const updated = layers.get(baseLayer.id);
    expect(updated?.colorCycleData?.eraseMask).toBe(mask);
    expect(updated?.colorCycleData?.eraseMaskVersion).toBe(0);
    expect(updateLayer).toHaveBeenCalledWith(
      baseLayer.id,
      expect.objectContaining({
        colorCycleData: expect.objectContaining({ eraseMask: mask })
      }),
      { skipColorCycleSync: true }
    );
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

    const { manager, layers, updateLayer } = setupManager(layer);
    const resizedMask = manager.resize(layer.id, 80, 80);

    expect(resizedMask.width).toBe(80);
    expect(resizedMask.height).toBe(80);

    expect(resizedMask).not.toBe(initialMask);
    const updatedLayer = layers.get(layer.id);
    expect(updatedLayer?.colorCycleData?.eraseMaskVersion).toBe(1);
    expect(updateLayer).toHaveBeenCalledWith(
      layer.id,
      expect.objectContaining({
        colorCycleData: expect.objectContaining({
          eraseMask: resizedMask,
          eraseMaskVersion: 1
        })
      }),
      { skipColorCycleSync: true }
    );
  });

  it('bumps mask versions without syncing color-cycle runtime state', () => {
    const layer = createLayer('layer-c', 60, 60);
    const { manager, updateLayer } = setupManager(layer);

    manager.bumpVersion(layer.id);

    expect(updateLayer).toHaveBeenCalledWith(
      layer.id,
      {
        colorCycleData: {
          eraseMaskVersion: 1
        }
      },
      { skipColorCycleSync: true }
    );
  });

  it('applies pending heal masks without updating layer state', () => {
    const layer = createLayer('layer-d', 8, 8);
    const eraseMask = document.createElement('canvas');
    eraseMask.width = 8;
    eraseMask.height = 8;
    const eraseMaskCtx = eraseMask.getContext('2d');
    if (!eraseMaskCtx) {
      throw new Error('Missing erase mask context');
    }
    eraseMaskCtx.fillStyle = 'rgba(0, 0, 0, 1)';
    eraseMaskCtx.fillRect(0, 0, eraseMask.width, eraseMask.height);
    layer.colorCycleData = {
      ...layer.colorCycleData,
      eraseMask,
      eraseMaskVersion: 0,
    };

    const { manager, updateLayer } = setupManager(layer);
    manager.addPendingHealMask(layer.id, {
      data: new Uint8Array([255]),
      width: 1,
      height: 1,
      bounds: { x: 3, y: 4, width: 1, height: 1 },
    });

    expect(updateLayer).not.toHaveBeenCalled();

    updateLayer.mockClear();
    expect(manager.commitPendingHealMask(layer.id)).toBe(true);
    expect(getAlpha(eraseMask, 3, 4)).toBe(0);
    expect(getAlpha(eraseMask, 2, 4)).toBe(255);
    expect(updateLayer).toHaveBeenCalledTimes(1);
  });

  it('commits a pending heal mask to the persisted erase mask once', () => {
    const layer = createLayer('layer-e', 8, 8);
    const eraseMask = document.createElement('canvas');
    eraseMask.width = 8;
    eraseMask.height = 8;
    const eraseMaskCtx = eraseMask.getContext('2d');
    if (!eraseMaskCtx) {
      throw new Error('Missing erase mask context');
    }
    eraseMaskCtx.fillStyle = 'rgba(0, 0, 0, 1)';
    eraseMaskCtx.fillRect(0, 0, eraseMask.width, eraseMask.height);
    layer.colorCycleData = {
      ...layer.colorCycleData,
      eraseMask,
      eraseMaskVersion: 0,
    };

    const { manager, updateLayer } = setupManager(layer);
    manager.addPendingHealMask(layer.id, {
      data: new Uint8Array([255]),
      width: 1,
      height: 1,
      bounds: { x: 3, y: 4, width: 1, height: 1 },
    });
    updateLayer.mockClear();

    expect(manager.commitPendingHealMask(layer.id)).toBe(true);

    expect(getAlpha(eraseMask, 3, 4)).toBe(0);
    expect(getAlpha(eraseMask, 2, 4)).toBe(255);
    expect(updateLayer).toHaveBeenCalledTimes(1);
    expect(updateLayer).toHaveBeenCalledWith(
      layer.id,
      { colorCycleData: { eraseMaskVersion: 1 } },
      { skipColorCycleSync: true }
    );
  });
});
