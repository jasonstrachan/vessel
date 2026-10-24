import { defaultBrushSettings } from '@/presets/brushPresets';
import { BrushShape, type BrushSettings, type SequentialStampPoint } from '@/types';

import { BrushEngineFacade } from '../BrushEngineFacade';
import { BrushStampTracker } from '../brushStampTracker';
import { MosaicStrokeRenderer } from '../mosaicStrokeRenderer';

const settings = (overrides: Partial<BrushSettings> = {}): BrushSettings => ({
  ...defaultBrushSettings,
  brushShape: BrushShape.MOSAIC,
  size: 60,
  spacing: 12,
  opacity: 1,
  antialiasing: false,
  pressureEnabled: false,
  rotationEnabled: false,
  rotationConfig: undefined,
  gridSnapEnabled: false,
  customBrushSnapEnabled: false,
  dashedEnabled: false,
  ditherEnabled: false,
  risographIntensity: 0,
  mosaicTilePx: 8,
  mosaicBlocksCount: 6,
  mosaicPaletteCount: 2,
  mosaicSeed: 12345,
  mosaicSegmentPx: 1000,
  mosaicSegmentJitter: 0,
  mosaicDitherEnabled: false,
  colorCycleGradient: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }],
  ...overrides,
});

const canvasContext = (): CanvasRenderingContext2D => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  return canvas.getContext('2d')!;
};

const runFacadeTrail = (velocity: number, enabled: boolean, segment = 1000) => {
  const brushSettings = settings({ velocitySpacingEnabled: enabled, mosaicSegmentPx: segment });
  const before = { ...brushSettings };
  const facade = new BrushEngineFacade({ brushSettings });
  const ctx = canvasContext();
  const sources: number[][] = [];
  const drawImage = jest.spyOn(ctx, 'drawImage').mockImplementation((source, ...args: number[]) => {
    const canvas = source as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([48, 8]);
    expect(args).toEqual([-24, -4, 48, 8]);
    sources.push([...canvas.getContext('2d')!.getImageData(0, 0, 48, 8).data]);
  });
  const stamps: SequentialStampPoint[] = [];
  for (let i = 0; i <= 16; i += 1) {
    facade.renderBrushStroke(ctx, {
      from: { x: 32 + Math.max(0, i - 1) * 12, y: 128 },
      to: { x: 32 + i * 12, y: 128 },
      pressure: 0.5,
      velocity,
      timestamp: i + 1,
    });
    stamps.push(...facade.consumeRecentStamps());
  }
  expect(drawImage).toHaveBeenCalledTimes(stamps.length);
  expect(stamps.every(stamp => stamp.size === 48 && stamp.alpha === 1)).toBe(true);
  expect(brushSettings).toEqual(before);
  return { centres: stamps.map(stamp => [stamp.x, stamp.y]), sources };
};

const rendererFixture = (overrides: Partial<BrushSettings> = {}) => {
  const brushSettings = settings({ velocitySpacingEnabled: true, ...overrides });
  const tracker = new BrushStampTracker();
  const ctx = canvasContext();
  const renderer = new MosaicStrokeRenderer({
    getBrushSettings: () => brushSettings,
    calculatePressureSize: size => size,
    canDrawAt: () => true,
    stampTracker: tracker,
  });
  // The existing five-argument callable also accepts an ignored optional JS
  // argument, so these tests reach the old behavior before the owner is repaired.
  const renderStroke: (
    ctx: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
    pressure: number,
    rotation: number,
    spacing?: number,
  ) => void = renderer.renderStroke.bind(renderer);
  const draw = (from: number, to: number, spacing?: number): number[] => {
    tracker.begin(0.5, 1);
    renderStroke(ctx, { x: from, y: 128 }, { x: to, y: 128 }, 0.5, 0, spacing);
    tracker.end();
    return tracker.consume().map(stamp => stamp.x);
  };
  return { renderer, draw, brushSettings };
};

describe('Mosaic velocity spacing at its actual renderer boundary', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('keeps VelOFF absolute centres and actual seeded material identical at slow/fast speeds', () => {
    const slow = runFacadeTrail(0.03, false);
    const fast = runFacadeTrail(2, false);
    expect(slow.centres).toEqual(Array.from({ length: 17 }, (_, i) => [32 + 12 * i, 128]));
    expect(fast).toEqual(slow);
    const shades = new Set(slow.sources[0].filter((_, i) => i % 4 === 0));
    expect([...shades].sort()).toEqual([64, 191].sort());
  });

  it('routes shared velocity-adjusted world spacing through the facade into real Mosaic placements', () => {
    const off = runFacadeTrail(2, false);
    const slow = runFacadeTrail(0.03, true);
    const fast = runFacadeTrail(2, true);
    expect(slow.centres).toEqual(off.centres);
    expect(fast.centres.length).toBeLessThan(off.centres.length);
    expect(fast.centres.length).toBeLessThan(slow.centres.length);
    expect(fast.centres[0]).toEqual([32, 128]);
    expect(fast.sources.every(source => source.every((value, i) => value === off.sources[0][i]))).toBe(true);
  });

  it('preserves distance already travelled when the effective interval grows', () => {
    const f = rendererFixture();
    expect(f.draw(0, 0, 10)).toEqual([0]);
    expect(f.draw(0, 6, 10)).toEqual([]);
    expect(f.draw(6, 19, 20)).toEqual([]);
    expect(f.draw(19, 20, 20)).toEqual([20]);
    expect(f.brushSettings.spacing).toBe(12);
  });

  it('preserves distance already travelled when the effective interval shrinks', () => {
    const f = rendererFixture();
    expect(f.draw(0, 0, 20)).toEqual([0]);
    expect(f.draw(0, 6, 20)).toEqual([]);
    expect(f.draw(6, 9, 10)).toEqual([]);
    expect(f.draw(9, 10, 10)).toEqual([10]);
  });

  it('consumes a repeated effective interval without restarting or compounding it', () => {
    const f = rendererFixture();
    expect(f.draw(0, 0, 20)).toEqual([0]);
    expect(f.draw(0, 5, 20)).toEqual([]);
    expect(f.draw(5, 10, 20)).toEqual([]);
    expect(f.draw(10, 15, 20)).toEqual([]);
    expect(f.draw(15, 20, 20)).toEqual([20]);
    expect(f.draw(20, 40, 20)).toEqual([40]);
  });

  it.each([undefined, NaN, Infinity, 0, -1])('uses the original base interval for an invalid or absent override (%s)', (spacing) => {
    const f = rendererFixture();
    expect(f.draw(0, 25, spacing)).toEqual([0, 12, 24]);
  });

  it('bounds a valid subpixel computed interval to one Mosaic world pixel', () => {
    const f = rendererFixture();
    expect(f.draw(0, 3, 0.25)).toEqual([0, 1, 2, 3]);
  });

  it.each([{ spacing: 7.4, expected: [0, 7, 14, 21] }, { spacing: 0, expected: [0, 6, 12, 18] }])('ignores computed overrides for VelOFF while retaining legacy base rounding/fallback (%j)', ({ spacing, expected }) => {
    const f = rendererFixture({ velocitySpacingEnabled: false, spacing });
    expect(f.draw(0, 21, 40)).toEqual(expected);
  });

  it('clears pending interval progress when the stroke is reset', () => {
    const f = rendererFixture();
    f.draw(0, 6, 20);
    f.renderer.reset();
    expect(f.draw(100, 100, 10)).toEqual([100]);
    expect(f.draw(100, 110, 10)).toEqual([110]);
  });

  it('keeps seed/palette/segment turnover unchanged for the existing VelOFF path', () => {
    const slow = runFacadeTrail(0.03, false, 24);
    const fast = runFacadeTrail(2, false, 24);
    expect(fast).toEqual(slow);
    expect(new Set(slow.sources.map(source => source.join(','))).size).toBeGreaterThan(1);
  });
});
