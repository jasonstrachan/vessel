import { buildLayersHash } from '@/components/canvas/layersHash';
import type { Layer } from '@/types';

const createLayer = (overrides: Partial<Layer> = {}): Layer =>
  ({
    id: 'layer-1',
    name: 'Layer',
    order: 0,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    layerType: 'normal',
    imageData: new ImageData(4, 4),
    framebuffer: null,
    alignment: {
      fit: 'none',
      horizontal: 'center',
      vertical: 'center',
      positioning: 'anchor',
    },
    version: 0,
    ...overrides,
  } as unknown as Layer);

describe('buildLayersHash', () => {
  it('changes when layer version changes for same-size image data', () => {
    const base = createLayer({ version: 1 });
    const next = createLayer({ version: 2 });

    const baseHash = buildLayersHash([base]);
    const nextHash = buildLayersHash([next]);

    expect(baseHash).not.toBe(nextHash);
  });

  it('changes when color-cycle erase mask version changes', () => {
    const ccBase = createLayer({
      layerType: 'color-cycle',
      colorCycleData: {
        gradient: [],
        isAnimating: false,
        eraseMaskVersion: 1,
      },
    });
    const ccNext = createLayer({
      layerType: 'color-cycle',
      colorCycleData: {
        gradient: [],
        isAnimating: false,
        eraseMaskVersion: 2,
      },
    });

    const baseHash = buildLayersHash([ccBase]);
    const nextHash = buildLayersHash([ccNext]);

    expect(baseHash).not.toBe(nextHash);
  });

  it('changes when color-cycle soft edge mask version changes', () => {
    const ccBase = createLayer({
      layerType: 'color-cycle',
      colorCycleData: {
        gradient: [],
        isAnimating: false,
        softEdgeMaskVersion: 1,
      },
    });
    const ccNext = createLayer({
      layerType: 'color-cycle',
      colorCycleData: {
        gradient: [],
        isAnimating: false,
        softEdgeMaskVersion: 2,
      },
    });

    expect(buildLayersHash([ccBase])).not.toBe(buildLayersHash([ccNext]));
  });

  it('changes when color-cycle soft edge mask enabled state changes', () => {
    const ccBase = createLayer({
      layerType: 'color-cycle',
      colorCycleData: {
        gradient: [],
        isAnimating: false,
        softEdgeMaskVersion: 1,
        softEdgeMaskEnabled: true,
      },
    });
    const ccNext = createLayer({
      layerType: 'color-cycle',
      colorCycleData: {
        gradient: [],
        isAnimating: false,
        softEdgeMaskVersion: 1,
        softEdgeMaskEnabled: false,
      },
    });

    expect(buildLayersHash([ccBase])).not.toBe(buildLayersHash([ccNext]));
  });
});
