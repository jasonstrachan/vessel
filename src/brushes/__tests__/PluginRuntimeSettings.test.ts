import type { BrushDrawContext } from '@/brushes/BrushPlugin';
import { ParticleBrushPlugin } from '@/brushes/plugins/ParticleBrushPlugin';
import { SpamBrushPlugin } from '@/brushes/plugins/SpamBrushPlugin';

import type { BrushSettings } from '@/types';

const createBaseSettings = (): BrushSettings => ({
  size: 10,
  opacity: 1,
  color: '#ffffff',
  blendMode: 'source-over',
  spacing: 1,
  pressure: 1,
  rotation: 0,
  antialiasing: true,
  pressureEnabled: true,
  minPressure: 0,
  rotationEnabled: false,
  dashedEnabled: false,
  dashLength: 8,
  useSwatchColor: true,
  dashGap: 4,
  gridSnapEnabled: false,
  shapeEnabled: false,
  colorJitter: 0,
  risographIntensity: 0,
  risographOutline: false,
  ditherEnabled: false,
});

const createCtx = (): CanvasRenderingContext2D =>
  ({
    save: jest.fn(),
    restore: jest.fn(),
    beginPath: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(),
    fillText: jest.fn(),
    translate: jest.fn(),
    rotate: jest.fn(),
    fillStyle: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
  }) as unknown as CanvasRenderingContext2D;

const createContext = (ctx: CanvasRenderingContext2D, settings: BrushSettings): BrushDrawContext => ({
  ctx,
  x: 10,
  y: 10,
  pressure: 1,
  settings,
  lastPoint: null,
});

describe('Plugin runtime settings', () => {
  it('applies particle density settings at draw time', () => {
    const plugin = new ParticleBrushPlugin();
    const lowCtx = createCtx();
    const highCtx = createCtx();

    plugin.draw(
      createContext(lowCtx, {
        ...createBaseSettings(),
        particleDensity: 3,
        particleScatterRadius: 1,
      })
    );
    plugin.draw(
      createContext(highCtx, {
        ...createBaseSettings(),
        particleDensity: 30,
        particleScatterRadius: 1,
      })
    );

    const lowArcCount = (lowCtx.arc as unknown as jest.Mock).mock.calls.length;
    const highArcCount = (highCtx.arc as unknown as jest.Mock).mock.calls.length;
    expect(highArcCount).toBeGreaterThan(lowArcCount);
  });

  it('applies spam font and custom text settings at draw time', () => {
    const plugin = new SpamBrushPlugin();
    const ctx = createCtx();

    plugin.draw(
      createContext(ctx, {
        ...createBaseSettings(),
        spamFont: 'menlo',
        spamContentType: 'crypto',
        spamCustomText: 'CUSTOM TEXT',
      })
    );

    expect((ctx.fillText as unknown as jest.Mock).mock.calls[0]?.[0]).toBe('CUSTOM TEXT');
    expect(ctx.font.toLowerCase()).toContain('menlo');
  });
});
