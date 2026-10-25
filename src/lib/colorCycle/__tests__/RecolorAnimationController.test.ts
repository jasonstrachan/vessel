import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { RecolorAnimationController } from '../RecolorAnimationController';

jest.mock('../RecolorEngine', () => ({ RecolorEngine: class { getStats() { return { memoryUsage: 0 }; } } }));

describe('RecolorAnimationController configured FPS', () => {
  it('updates timing for every registered layer without changing clock or indexed source', () => {
    const controller = new RecolorAnimationController();
    const makeLayer = (id: string, speed: number): Layer => ({
      id, name: id, layerType: 'color-cycle', visible: true, locked: false, opacity: 1, order: 0,
      blendMode: 'source-over', imageData: new ImageData(1, 1), framebuffer: document.createElement('canvas'),
      alignment: createDefaultLayerAlignment(), colorCycleData: { mode: 'recolor', recolorSettings: {
        quantizationMode: 'rgb332', ditherMode: 'off', currentLOD: 'full', cycleColors: 16, gradient: [],
        originalImageData: new ImageData(1, 1), indexBuffer: new Uint8Array([1]), palette: new Uint32Array([0, 0xff123456]),
        animation: { speed, fps: 60, ticksPerFrame: 0, currentTick: 7.25, isPlaying: false, flowDirection: 'forward' },
      } },
    });
    const layers = [makeLayer('a', 0.5), makeLayer('b', 1)];
    const sources = layers.map(layer => layer.colorCycleData!.recolorSettings!.indexBuffer);
    for (const layer of layers) expect(controller.registerLayer(layer)).toBe(true);
    for (const fps of [15, 30, 60]) {
      controller.setFPS(fps);
      expect(controller.getConfiguredFPS()).toBe(fps);
      layers.forEach((layer, i) => {
        const settings = layer.colorCycleData!.recolorSettings!;
        expect(settings.animation.fps).toBe(fps);
        expect(settings.animation.ticksPerFrame).toBe(settings.animation.speed * 16 / fps);
        expect(settings.animation.currentTick).toBe(7.25);
        expect(settings.indexBuffer).toBe(sources[i]);
      });
    }
    controller.cleanup();
  });

  it('exposes configured target independently from measured FPS and preserves clamping', () => {
    const controller = new RecolorAnimationController();
    expect(controller.getConfiguredFPS()).toBe(60);
    expect(controller.getStats().fps).toBe(0);
    controller.setFPS(15);
    expect(controller.getConfiguredFPS()).toBe(15);
    controller.setFPS(100);
    expect(controller.getConfiguredFPS()).toBe(60);
    controller.setFPS(1);
    expect(controller.getConfiguredFPS()).toBe(15);
    controller.cleanup();
  });
});
