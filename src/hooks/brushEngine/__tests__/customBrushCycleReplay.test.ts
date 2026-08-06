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
    expect(service.capturedPatternCacheBytes).toBe(16);
    expect(service.paletteCacheSize).toBe(1);
    expect(service.version).toBe(0);
  });

  it('replays schema v3 indexed tips from the captured gradient', () => {
    const service = new CustomBrushCycleReplayService(createSettings());
    const brush = createCapturedDataBrush();
    brush.colorCycle = {
      schemaVersion: 3,
      payloadKind: 'indexed-tip',
      gradient: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      sourceCycleLength: 4,
      mapWidth: 2,
      mapHeight: 2,
      paintIndexMap: new Uint16Array([0, 1, 2, 3]),
    };
    brush.colorCycleMode = 'captured-data';

    const pattern = service.getCapturedDataPattern(brush, 0);

    expect(pattern).not.toBeNull();
    expect(new Set([
      pattern?.data[0],
      pattern?.data[4],
      pattern?.data[8],
      pattern?.data[12],
    ]).size).toBeGreaterThan(1);
  });

  it('uses captured alpha as the mask instead of multiplying it twice', () => {
    const service = new CustomBrushCycleReplayService(createSettings());
    const brush = createCapturedDataBrush();
    brush.imageData.data[3] = 128;
    brush.colorCycle = {
      schemaVersion: 3,
      payloadKind: 'indexed-tip',
      sourceCycleLength: 4,
      mapWidth: 2,
      mapHeight: 2,
      paintIndexMap: new Uint16Array([0, 1, 2, 3]),
      alphaMask: new Uint8Array([128, 255, 255, 255]),
    };
    brush.colorCycleMode = 'captured-data';
    brush.useCapturedAlphaMask = true;

    expect(service.getCapturedDataPattern(brush, 0)?.data[3]).toBe(128);
  });

  it('clears replay caches and advances version when gradient settings invalidate them', () => {
    const service = new CustomBrushCycleReplayService(createSettings());
    const brush = createCapturedDataBrush();
    service.getCapturedDataPattern(brush, 0.25);

    service.updateBrushSettings(createSettings('#ff0000'));

    expect(service.version).toBe(1);
    expect(service.capturedPatternCacheSize).toBe(0);
    expect(service.paletteCacheSize).toBe(0);
    expect(service.capturedPatternCacheBytes).toBe(0);
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
    expect(service.capturedPatternCacheBytes).toBe(0);
  });

  it('evicts least-recently-used frames when the byte budget is exceeded', () => {
    const service = new CustomBrushCycleReplayService(createSettings(), 32);
    const brush = createCapturedDataBrush();

    const first = service.getCapturedDataPattern(brush, 0);
    const second = service.getCapturedDataPattern(brush, 0.25);
    service.getCapturedDataPattern(brush, 0);
    const third = service.getCapturedDataPattern(brush, 0.5);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(third).not.toBeNull();
    expect(service.capturedPatternCacheSize).toBe(2);
    expect(service.capturedPatternCacheBytes).toBeLessThanOrEqual(32);
    expect(service.getCapturedDataPattern(brush, 0)).toBe(first);
    expect(service.getCapturedDataPattern(brush, 0.25)).not.toBe(second);
  });
});
