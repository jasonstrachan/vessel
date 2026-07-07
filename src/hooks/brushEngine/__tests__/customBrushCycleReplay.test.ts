import type { BrushSettings } from '@/types';

import { CustomBrushCycleReplayService, type CustomBrushCycleStrokeData } from '../customBrushCycleReplay';

const createSettings = (endColor = '#ffffff'): BrushSettings => ({
  customBrushColorCycle: true,
  customBrushCcPhaseMode: 'global',
  colorCycleSpeed: 0.1,
  colorCycleGradient: [
    { position: 0, color: '#000000' },
    { position: 1, color: endColor },
  ],
} as BrushSettings);

const createCapturedDataBrush = (): CustomBrushCycleStrokeData => {
  const imageData = new ImageData(
    new Uint8ClampedArray([
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
    ]),
    2,
    2,
  );
  return {
    imageData,
    width: 2,
    height: 2,
    cacheKey: 'captured-brush',
    colorCycle: {
      schemaVersion: 2,
      mode: 'captured-data',
      sourceCycleLength: 4,
      mapWidth: 2,
      mapHeight: 2,
      phaseMap: new Uint16Array([0, 1, 2, 3]),
      useAlphaMask: false,
    },
  };
};

describe('CustomBrushCycleReplayService', () => {
  it('reuses captured-data replay frames through a versioned cache service', () => {
    const service = new CustomBrushCycleReplayService(createSettings());
    const brush = createCapturedDataBrush();

    const first = service.getCapturedDataPattern(brush, 0.25);
    const second = service.getCapturedDataPattern(brush, 0.25);

    expect(second).toBe(first);
    expect(service.capturedPatternCacheSize).toBe(1);
    expect(service.paletteCacheSize).toBe(1);
    expect(service.version).toBe(0);
  });

  it('clears replay caches and advances version when gradient settings invalidate them', () => {
    const service = new CustomBrushCycleReplayService(createSettings());
    const brush = createCapturedDataBrush();
    service.getCapturedDataPattern(brush, 0.25);

    service.updateBrushSettings(createSettings('#ff0000'));

    expect(service.version).toBe(1);
    expect(service.capturedPatternCacheSize).toBe(0);
    expect(service.paletteCacheSize).toBe(0);
  });

  it('clears replay caches and advances version when custom color cycling is disabled', () => {
    const service = new CustomBrushCycleReplayService(createSettings());
    const brush = createCapturedDataBrush();
    service.getCapturedDataPattern(brush, 0.25);

    service.updateBrushSettings({
      ...createSettings(),
      customBrushColorCycle: false,
    } as BrushSettings);

    expect(service.version).toBe(1);
    expect(service.capturedPatternCacheSize).toBe(0);
    expect(service.paletteCacheSize).toBe(0);
  });
});
