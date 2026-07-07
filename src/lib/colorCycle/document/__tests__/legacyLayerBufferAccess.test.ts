import {
  getColorCycleLegacyLayerBuffer,
  getColorCycleLegacyLayerBufferByteLength,
  getColorCycleLegacyLayerBuffers,
} from '../legacyLayerBufferAccess';
import { attachLegacyColorCycleTopLevelBuffers } from '../legacyTopLevelBuffers';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';

const createColorCycleLayer = (): Layer => {
  const canvas = document.createElement('canvas');
  return {
    id: 'layer-cc',
    name: 'CC',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    order: 0,
    imageData: null,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'color-cycle',
    colorCycleData: attachLegacyColorCycleTopLevelBuffers(
      { documentId: 'layer-cc' },
      {
        gradientIdBuffer: new Uint8Array([1, 2]).buffer,
        gradientDefIdBuffer: new Uint16Array([3, 4]).buffer,
      },
    ),
  };
};

describe('legacyLayerBufferAccess', () => {
  it('centralizes deprecated layer buffer mirror reads', () => {
    const layer = createColorCycleLayer();

    const gradientIdBuffer = getColorCycleLegacyLayerBuffer(layer.colorCycleData, 'gradientIdBuffer');
    const gradientDefIdBuffer = getColorCycleLegacyLayerBuffer(layer.colorCycleData, 'gradientDefIdBuffer');
    expect(getColorCycleLegacyLayerBuffer(layer.colorCycleData, 'gradientIdBuffer')?.byteLength).toBe(2);
    expect(getColorCycleLegacyLayerBufferByteLength(layer.colorCycleData, 'gradientDefIdBuffer')).toBe(4);
    expect(getColorCycleLegacyLayerBuffers(layer)).toEqual({
      gradientIdBuffer,
      gradientDefIdBuffer,
    });
  });

  it('returns empty accessors for non-color-cycle layers and missing buffers', () => {
    const canvas = document.createElement('canvas');
    const layer: Layer = {
      id: 'layer-normal',
      name: 'Normal',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      transparencyLocked: false,
      order: 0,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'normal',
    };

    expect(getColorCycleLegacyLayerBuffer(null, 'gradientIdBuffer')).toBeUndefined();
    expect(getColorCycleLegacyLayerBufferByteLength(undefined, 'gradientIdBuffer')).toBe(0);
    expect(getColorCycleLegacyLayerBuffers(layer)).toEqual({});
  });
});
