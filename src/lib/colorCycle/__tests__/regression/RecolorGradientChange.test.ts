import { RecolorManager } from '../../../colorCycle/RecolorManager';
import type { Layer } from '../../../../types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

describe('Recolor gradient change preserves image data', () => {
  it('keeps layer.imageData non-null after gradient change in recolor mode', () => {
    const manager = RecolorManager.getInstance();

    // Patch internals to avoid heavy engine/canvas work
    const managerProxy = manager as unknown as {
      engine: {
        updateGradient: (layer: Layer, gradient: Array<{ position: number; color: string }>) => boolean;
      };
      animationController: {
        updateLayer: (layer: Layer) => void;
        getLayers: () => Layer[];
        isAnimating: () => boolean;
        getStats: () => Record<string, unknown>;
      };
      updateGradient: (layer: Layer, gradient: Array<{ position: number; color: string }>) => boolean;
    };

    managerProxy.engine = {
      updateGradient: jest.fn().mockReturnValue(true)
    };
    managerProxy.animationController = {
      updateLayer: jest.fn((layer: Layer) => {
        if (!layer.imageData) {
          layer.imageData = new ImageData(1, 1);
        }
      }),
      getLayers: jest.fn(() => []),
      isAnimating: jest.fn(() => false),
      getStats: jest.fn(() => ({}))
    };

    const framebuffer = ({ width: 1, height: 1 } as unknown) as OffscreenCanvas;

    const layer: Layer = {
      id: 'layer-test',
      name: 'Test',
      visible: true,
      opacity: 1,
      blendMode: 'source-over' as GlobalCompositeOperation,
      locked: false,
      order: 0,
      imageData: new ImageData(1, 1),
      framebuffer,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        mode: 'recolor',
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' }
        ],
        recolorSettings: {
          quantizationMode: 'rgb332',
          ditherMode: 'off',
          animation: {
            speed: 0.4,
            fps: 30,
            ticksPerFrame: 1,
            isPlaying: false,
            currentTick: 0,
            flowDirection: 'forward'
          },
          cycleColors: 16,
          gradient: [
            { position: 0, color: '#000000' },
            { position: 1, color: '#ffffff' }
          ],
          mappingMode: 'banded',
          currentLOD: 'full',
          originalImageData: new ImageData(1, 1),
          indexBuffer: new Uint8Array(1),
          palette: new Uint32Array(256)
        }
      }
    };

    const ok = managerProxy.updateGradient(layer, [
      { position: 0, color: '#ff0000' },
      { position: 1, color: '#00ff00' }
    ]);

    expect(ok).toBe(true);
    expect(layer.imageData).not.toBeNull();
  });
});
