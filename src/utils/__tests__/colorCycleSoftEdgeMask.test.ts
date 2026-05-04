import { buildColorCycleSoftEdgeMask } from '@/utils/colorCycleSoftEdgeMask';
import type { Layer } from '@/types';

const createCoverageLayer = (
  paint: (ctx: CanvasRenderingContext2D) => void,
  size = 9,
): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
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
      canvasWidth: size,
      canvasHeight: size,
    },
  } as Layer;
};

describe('buildColorCycleSoftEdgeMask', () => {
  it('dithers hard covered edge pixels so destination-in changes the visible boundary', () => {
    const result = buildColorCycleSoftEdgeMask(createCoverageLayer((ctx) => {
      ctx.fillRect(1, 1, 7, 7);
    }), 3);

    expect(result).not.toBeNull();
    const data = result!.softEdgeMaskImageData.data;
    const alphaAt = (x: number, y: number) => data[(y * 9 + x) * 4 + 3] ?? 0;
    const edgeBand: number[] = [];
    for (let y = 1; y <= 7; y += 1) {
      for (let x = 1; x <= 7; x += 1) {
        if (x === 4 && y === 4) {
          continue;
        }
        edgeBand.push(alphaAt(x, y));
      }
    }

    expect(new Set(edgeBand).size).toBeGreaterThan(1);
    expect(edgeBand.every((alpha) => alpha === 0 || alpha === 255)).toBe(true);
    expect(alphaAt(0, 0)).toBe(0);
  });

  it('keeps covered interiors opaque while pixelating only the edge band', () => {
    const result = buildColorCycleSoftEdgeMask(createCoverageLayer((ctx) => {
      ctx.fillRect(1, 1, 7, 7);
    }), 2);

    expect(result).not.toBeNull();
    const data = result!.softEdgeMaskImageData.data;
    const alphaAt = (x: number, y: number) => data[(y * 9 + x) * 4 + 3];

    expect(alphaAt(4, 4)).toBe(255);
    expect([0, 255]).toContain(alphaAt(1, 4));
  });

  it('makes larger edge widths remove more covered edge pixels', () => {
    const layer = createCoverageLayer((ctx) => {
      ctx.fillRect(1, 1, 13, 13);
    }, 15);
    const narrow = buildColorCycleSoftEdgeMask(layer, 1);
    const wide = buildColorCycleSoftEdgeMask(layer, 6);

    expect(narrow).not.toBeNull();
    expect(wide).not.toBeNull();
    const countKept = (imageData: ImageData) => {
      let kept = 0;
      for (let index = 3; index < imageData.data.length; index += 4) {
        if (imageData.data[index] === 255) {
          kept += 1;
        }
      }
      return kept;
    };

    expect(countKept(wide!.softEdgeMaskImageData)).toBeLessThan(
      countKept(narrow!.softEdgeMaskImageData),
    );
  });

  it('uses dither size to scale the ordered edge pattern', () => {
    const layer = createCoverageLayer((ctx) => {
      ctx.fillRect(1, 1, 13, 13);
    }, 15);
    const fine = buildColorCycleSoftEdgeMask(layer, 5, null, { ditherSize: 1 });
    const coarse = buildColorCycleSoftEdgeMask(layer, 5, null, { ditherSize: 4 });

    expect(fine).not.toBeNull();
    expect(coarse).not.toBeNull();
    expect(Array.from(coarse!.softEdgeMaskImageData.data)).not.toEqual(
      Array.from(fine!.softEdgeMaskImageData.data),
    );
  });

  it('can use Sierra Lite error diffusion for the edge pattern', () => {
    const layer = createCoverageLayer((ctx) => {
      ctx.fillRect(1, 1, 13, 13);
    }, 15);
    const ordered = buildColorCycleSoftEdgeMask(layer, 5, null, {
      ditherSize: 2,
      ditherAlgorithm: 'ordered',
    });
    const sierraLite = buildColorCycleSoftEdgeMask(layer, 5, null, {
      ditherSize: 2,
      ditherAlgorithm: 'sierra-lite',
    });

    expect(ordered).not.toBeNull();
    expect(sierraLite).not.toBeNull();
    expect(Array.from(sierraLite!.softEdgeMaskImageData.data)).not.toEqual(
      Array.from(ordered!.softEdgeMaskImageData.data),
    );
  });

  it('treats coverage outside the canvas as transparent so full-canvas shapes still dither at the edge', () => {
    const result = buildColorCycleSoftEdgeMask(createCoverageLayer((ctx) => {
      ctx.fillRect(0, 0, 9, 9);
    }), 3);

    expect(result).not.toBeNull();
    const data = result!.softEdgeMaskImageData.data;
    const alphaAt = (x: number, y: number) => data[(y * 9 + x) * 4 + 3] ?? 0;
    const topEdge = Array.from({ length: 9 }, (_, x) => alphaAt(x, 0));

    expect(alphaAt(4, 4)).toBe(255);
    expect(new Set(topEdge).size).toBeGreaterThan(1);
    expect(topEdge.every((alpha) => alpha === 0 || alpha === 255)).toBe(true);
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
        width: 9,
        height: 9,
        alpha: new Uint8ClampedArray([
          0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 255, 255, 255, 255, 255, 255, 255, 0,
          0, 255, 255, 255, 255, 255, 255, 255, 0,
          0, 255, 255, 255, 255, 255, 255, 255, 0,
          0, 255, 255, 255, 255, 255, 255, 255, 0,
          0, 255, 255, 255, 255, 255, 255, 255, 0,
          0, 255, 255, 255, 255, 255, 255, 255, 0,
          0, 255, 255, 255, 255, 255, 255, 255, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]),
      },
    );

    expect(result).not.toBeNull();
    const data = result!.softEdgeMaskImageData.data;
    const alphaAt = (x: number, y: number) => data[(y * 9 + x) * 4 + 3];

    expect(alphaAt(4, 4)).toBe(255);
    expect([0, 255]).toContain(alphaAt(4, 1));
  });
});
