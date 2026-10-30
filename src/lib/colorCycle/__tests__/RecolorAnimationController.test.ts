import type { Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import { RecolorAnimationController } from '../RecolorAnimationController';
import { getSharedAnimationRuntime } from '@/runtime/playback/animationRuntime';

jest.mock('../RecolorEngine', () => ({ RecolorEngine: class {
  getStats() { return { memoryUsage: 0 }; }
  renderFrame() { return null; }
} }));

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

  it('uses the shared clock and advances by elapsed time across delayed frames and resume', () => {
    const controller = new RecolorAnimationController();
    const layer = {
      id: 'recolor-clock', visible: true, imageData: new ImageData(1, 1),
      colorCycleData: { mode: 'recolor', recolorSettings: {
        indexBuffer: new Uint8Array([1]), cycleColors: 16, currentLOD: 'full',
        animation: { speed: 0.5, currentTick: 0, ticksPerFrame: 0, fps: 60 },
      } },
    } as Layer;
    const runtime = getSharedAnimationRuntime();
    let consume: ((timestamp: number, delta: number) => void) | undefined;
    const unregister = jest.fn();
    const registration = jest.spyOn(runtime, 'register').mockImplementation((callback) => {
      consume = callback;
      return unregister;
    });
    const start = jest.spyOn(runtime, 'start').mockImplementation(() => {});
    const now = jest.spyOn(performance, 'now').mockReturnValue(0);
    try {
      controller.registerLayer(layer);
      controller.playAll();
      consume?.(100, 100);
      expect(layer.colorCycleData?.recolorSettings?.animation.currentTick).toBeCloseTo(0.8);
      controller.pause();
      expect(unregister).toHaveBeenCalledTimes(1);
      now.mockReturnValue(10_000);
      controller.resume();
      consume?.(10_100, 100);
      expect(layer.colorCycleData?.recolorSettings?.animation.currentTick).toBeCloseTo(1.6);
      expect(registration).toHaveBeenCalledTimes(2);
    } finally {
      controller.cleanup();
      now.mockRestore();
      start.mockRestore();
      registration.mockRestore();
    }
  });
});
