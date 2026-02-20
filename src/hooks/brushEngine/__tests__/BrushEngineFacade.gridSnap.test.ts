import { BrushEngineFacade } from '@/hooks/brushEngine/BrushEngineFacade';
import { BrushShape, type BrushSettings } from '@/types';

const createBaseSettings = (): BrushSettings => ({
  size: 8,
  opacity: 1,
  color: '#000000',
  blendMode: 'source-over',
  spacing: 20,
  pressure: 1,
  rotation: 0,
  antialiasing: false,
  pressureEnabled: false,
  minPressure: 1,
  maxPressure: 100,
  rotationEnabled: false,
  dashedEnabled: false,
  dashLength: 3,
  dashGap: 2,
  gridSnapEnabled: true,
  gridSnapSize: 8,
  shapeEnabled: false,
  useSwatchColor: false,
  colorJitter: 0,
  risographIntensity: 0,
  risographOutline: false,
  ditherEnabled: false,
  brushShape: BrushShape.SQUARE,
});

describe('BrushEngineFacade grid snap stamping', () => {
  it('stamps across every traversed grid cell for pixel square regardless of spacing', () => {
    const engine = new BrushEngineFacade({
      brushSettings: createBaseSettings(),
    });
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
    if (!ctx) {
      return;
    }

    engine.renderBrushStroke(ctx, {
      from: { x: 0, y: 0 },
      to: { x: 32, y: 0 },
      pressure: 1,
      velocity: 1,
      timestamp: performance.now(),
    });

    const stamps = engine.consumeRecentStamps();
    const uniqueX = Array.from(new Set(stamps.map((stamp) => stamp.x))).sort((a, b) => a - b);
    expect(uniqueX).toEqual([0, 8, 16, 24, 32]);
  });

  it('uses spacing-driven stamps when grid snap is disabled', () => {
    const engine = new BrushEngineFacade({
      brushSettings: {
        ...createBaseSettings(),
        gridSnapEnabled: false,
      },
    });
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();
    if (!ctx) {
      return;
    }

    engine.renderBrushStroke(ctx, {
      from: { x: 0, y: 0 },
      to: { x: 32, y: 0 },
      pressure: 1,
      velocity: 1,
      timestamp: performance.now(),
    });

    const stamps = engine.consumeRecentStamps();
    expect(stamps.length).toBeLessThan(5);
  });
});
