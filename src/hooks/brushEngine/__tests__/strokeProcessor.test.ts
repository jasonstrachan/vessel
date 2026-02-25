import { createPixelQueue, shouldDrawStamp, createStrokeProcessor } from '../strokeProcessor';
import { BrushShape, type BrushSettings } from '@/types';

const baseBrushSettings: BrushSettings = {
  size: 80,
  opacity: 1,
  color: '#000000',
  blendMode: 'source-over',
  spacing: 0.2,
  pressure: 1,
  rotation: 0,
  antialiasing: true,
  pressureEnabled: false,
  minPressure: 1,
  maxPressure: 100,
  rotationEnabled: false,
  dashedEnabled: true,
  dashLength: 1,
  dashGap: 1,
  gridSnapEnabled: false,
  shapeEnabled: false,
  useSwatchColor: false,
  colorJitter: 0,
  risographIntensity: 0,
  risographOutline: false,
  ditherEnabled: false,
};

describe('shouldDrawStamp', () => {

  it('treats length=1 as roughly one brush-size of paint', () => {
    const queue = createPixelQueue();
    const brushSize = baseBrushSettings.size; // 80px

    const samples = Array.from({ length: 24 }, () => shouldDrawStamp(baseBrushSettings, queue, brushSize, false));

    const dashCount = samples.findIndex((draws, idx) => idx > 0 && !draws);
    const gapStart = dashCount;
    const gapCount = samples.slice(gapStart).findIndex(Boolean);

    expect(dashCount).toBeGreaterThan(0); // we drew something
    expect(gapCount).toBeGreaterThan(0); // we eventually hit a gap
    expect(dashCount * (brushSize * 0.2)).toBeLessThanOrEqual(brushSize * 1.2); // spacing 0.2 => ~16px between centers
  });

  it('treats gap=1 as roughly one brush-size of blank space', () => {
    const queue = createPixelQueue();
    const brushSize = baseBrushSettings.size; // 80px

    // Advance through one full cycle plus a few steps
    const samples = Array.from({ length: 40 }, () => shouldDrawStamp(baseBrushSettings, queue, brushSize, false));

    const dashCount = samples.findIndex((draws, idx) => idx > 0 && !draws);
    const gapStart = dashCount;
    const gapCount = samples.slice(gapStart).findIndex(Boolean);

    expect(dashCount).toBeGreaterThan(0);
    expect(gapCount).toBeGreaterThan(0);

    // Center-to-center distance between last dash and first dash after gap
    const centerDistance = (gapCount + 1) * (brushSize * 0.2); // spacing 0.2 => 16px step
    const blankDistance = centerDistance - brushSize; // subtract footprint

    expect(blankDistance).toBeGreaterThanOrEqual(brushSize * 0.7);
    expect(blankDistance).toBeLessThanOrEqual(brushSize * 1.3);
  });

  it('expands gap explicitly when velocity-linked gap is enabled', () => {
    const brushSize = baseBrushSettings.size; // 80px
    const spacingPx = brushSize * 0.2; // 16px

    const runCycle = (settings: BrushSettings, speedSamplePx: number) => {
      const queue = createPixelQueue();
      const samples = Array.from(
        { length: 64 },
        () => shouldDrawStamp(settings, queue, brushSize, false, speedSamplePx, spacingPx)
      );
      const dashCount = samples.findIndex((draws, idx) => idx > 0 && !draws);
      const gapStart = dashCount;
      const gapCount = samples.slice(gapStart).findIndex(Boolean);
      const falseCount = samples.filter((draws) => !draws).length;
      return { dashCount, gapCount, falseCount };
    };

    const noVelocity = runCycle(
      {
        ...baseBrushSettings,
        dashLength: 1,
        dashGap: 1,
        velocityDashGapStrength: 0,
      },
      spacingPx * 4
    );

    const withVelocity = runCycle(
      {
        ...baseBrushSettings,
        dashLength: 1,
        dashGap: 1,
        velocityDashGapStrength: 10,
      },
      spacingPx * 4
    );

    expect(noVelocity.gapCount).toBeGreaterThan(0);
    expect(withVelocity.falseCount).toBeGreaterThan(noVelocity.falseCount);
  });
});

describe('pigment lift mask', () => {
  it('restores composite/alpha after applying lift and erases once', () => {
    const stroke = createStrokeProcessor({
      applyThrottledColorJitter: (color: string) => color,
      drawShape: jest.fn(),
    });

    const ctx = {
      fillStyle: '#000',
      globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
      globalAlpha: 1,
      drawImage: jest.fn(),
    } as unknown as CanvasRenderingContext2D;

    const renderSettings = {
      size: 12,
      opacity: 1,
      color: '#000000',
      antiAliasing: true,
      pixelAlignment: false,
      spacing: 1,
      rotation: 0,
      shape: BrushShape.ROUND,
      risographIntensity: 0,
    };

    const queue = stroke.createPixelQueue();
    const brushSettings: BrushSettings = {
      ...baseBrushSettings,
      pigmentLiftEnabled: true,
      pigmentLiftStrength: 0.5,
      pigmentLiftFeather: 1,
      pigmentLiftNoise: 0,
    };

    stroke.perfectPixels(ctx, 0, 0, renderSettings, queue, brushSettings);

    expect(ctx.globalCompositeOperation).toBe('source-over');
    expect(ctx.globalAlpha).toBe(1);
    expect((ctx as unknown as { drawImage: jest.Mock }).drawImage).toHaveBeenCalled();
  });
});
