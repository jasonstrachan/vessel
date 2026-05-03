import { buildColorCycleSoftEdgeMask } from '@/utils/colorCycleSoftEdgeMask';
import type { Layer } from '@/types';

const createCoverageLayer = (paint: (ctx: CanvasRenderingContext2D) => void): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 5;
  canvas.height = 5;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(255, 255, 255, 1)';
  paint(ctx);

  return {
    id: 'cc-soft-edge-test',
    name: 'CC Soft Edge Test',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    order: 0,
    layerType: 'color-cycle',
    colorCycleData: {
      canvas,
      canvasWidth: 5,
      canvasHeight: 5,
    },
  } as Layer;
};

describe('buildColorCycleSoftEdgeMask', () => {
  it('softens hard covered edge pixels so destination-in changes the visible boundary', () => {
    const result = buildColorCycleSoftEdgeMask(createCoverageLayer((ctx) => {
      ctx.fillRect(2, 2, 1, 1);
    }), 1);

    expect(result).not.toBeNull();
    const data = result!.softEdgeMaskImageData.data;
    const alphaAt = (x: number, y: number) => data[(y * 5 + x) * 4 + 3];

    expect(alphaAt(2, 2)).toBeGreaterThan(0);
    expect(alphaAt(2, 2)).toBeLessThan(255);
    expect(alphaAt(2, 1)).toBeGreaterThan(0);
    expect(alphaAt(2, 1)).toBeLessThan(255);
    expect(alphaAt(0, 0)).toBe(0);
  });

  it('keeps covered interiors opaque while softening only the edge band', () => {
    const result = buildColorCycleSoftEdgeMask(createCoverageLayer((ctx) => {
      ctx.fillRect(1, 1, 3, 3);
    }), 1);

    expect(result).not.toBeNull();
    const data = result!.softEdgeMaskImageData.data;
    const alphaAt = (x: number, y: number) => data[(y * 5 + x) * 4 + 3];

    expect(alphaAt(2, 2)).toBe(255);
    expect(alphaAt(1, 2)).toBeGreaterThan(0);
    expect(alphaAt(1, 2)).toBeLessThan(255);
  });

  it('treats coverage outside the canvas as transparent so full-canvas shapes still fade at the edge', () => {
    const result = buildColorCycleSoftEdgeMask(createCoverageLayer((ctx) => {
      ctx.fillRect(0, 0, 5, 5);
    }), 1);

    expect(result).not.toBeNull();
    const data = result!.softEdgeMaskImageData.data;
    const alphaAt = (x: number, y: number) => data[(y * 5 + x) * 4 + 3];

    expect(alphaAt(2, 2)).toBe(255);
    expect(alphaAt(0, 2)).toBeGreaterThan(0);
    expect(alphaAt(0, 2)).toBeLessThan(255);
    expect(alphaAt(0, 0)).toBeGreaterThan(0);
    expect(alphaAt(0, 0)).toBeLessThan(255);
  });

  it('uses canonical coverage when supplied instead of rendered dither holes', () => {
    const result = buildColorCycleSoftEdgeMask(
      createCoverageLayer((ctx) => {
        ctx.fillRect(1, 1, 1, 1);
        ctx.fillRect(3, 1, 1, 1);
        ctx.fillRect(2, 2, 1, 1);
        ctx.fillRect(1, 3, 1, 1);
        ctx.fillRect(3, 3, 1, 1);
      }),
      1,
      {
        width: 5,
        height: 5,
        alpha: new Uint8ClampedArray([
          0, 0, 0, 0, 0,
          0, 255, 255, 255, 0,
          0, 255, 255, 255, 0,
          0, 255, 255, 255, 0,
          0, 0, 0, 0, 0,
        ]),
      },
    );

    expect(result).not.toBeNull();
    const data = result!.softEdgeMaskImageData.data;
    const alphaAt = (x: number, y: number) => data[(y * 5 + x) * 4 + 3];

    expect(alphaAt(2, 2)).toBe(255);
    expect(alphaAt(2, 1)).toBeGreaterThan(0);
    expect(alphaAt(2, 1)).toBeLessThan(255);
  });
});
