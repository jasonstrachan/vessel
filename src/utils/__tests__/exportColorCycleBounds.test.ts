import {
  scaleMaskBoundsToDocument,
  deriveCoverageFromIndexBuffer
} from '@/utils/export/colorCycleBounds';

describe('scaleMaskBoundsToDocument', () => {
  it('scales mask coverage into document coordinates', () => {
    const maskBounds = { x: 64, y: 32, width: 128, height: 256 };
    const maskSize = { width: 512, height: 512 };
    const document = { width: 2048, height: 1024 };

    const scaled = scaleMaskBoundsToDocument(maskBounds, maskSize, document);

    expect(scaled.x).toBeCloseTo(256);
    expect(scaled.y).toBeCloseTo(64);
    expect(scaled.width).toBeCloseTo(512);
    expect(scaled.height).toBeCloseTo(512);
  });

  it('clamps overflow to the document bounds', () => {
    const maskBounds = { x: -10, y: -5, width: 600, height: 600 };
    const maskSize = { width: 512, height: 512 };
    const document = { width: 512, height: 512 };

    const scaled = scaleMaskBoundsToDocument(maskBounds, maskSize, document);

    expect(scaled.x).toBe(0);
    expect(scaled.y).toBe(0);
    expect(scaled.width).toBe(512);
    expect(scaled.height).toBe(512);
  });
});

describe('deriveCoverageFromIndexBuffer', () => {
  it('returns tight coverage for non-zero indices', () => {
    const width = 8;
    const height = 4;
    const buffer = new Uint8Array(width * height);
    buffer[5] = 3; // (5,0)
    buffer[width * 2 + 1] = 2; // (1,2)
    buffer[width * 3 + 6] = 4; // (6,3)

    const coverage = deriveCoverageFromIndexBuffer(buffer, width, height);

    expect(coverage).toEqual({ x: 1, y: 0, width: 6, height: 4 });
  });

  it('ignores transparent (zero) entries and handles short buffers', () => {
    const width = 5;
    const height = 4;
    const buffer = new Uint8Array([
      0, 0, 0, 0, 0,
      0, 2, 0, 0, 0,
      0, 0, 0, 0, 3
    ]); // shorter than width*height

    const coverage = deriveCoverageFromIndexBuffer(buffer, width, height);

    expect(coverage).toEqual({ x: 1, y: 1, width: 4, height: 2 });
  });

  it('returns undefined when all entries are zero', () => {
    const buffer = new Uint8Array(16);
    expect(deriveCoverageFromIndexBuffer(buffer, 4, 4)).toBeUndefined();
  });
});
