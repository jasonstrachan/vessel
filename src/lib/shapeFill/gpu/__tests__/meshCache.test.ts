import { getShapeFillMeshCache, resetShapeFillMeshCache, hashStructuredValue } from '../meshCache';
import type { QuadExpandResult } from '../QuadExpander';

const makeGeometry = (id: string, vertexCount: number, stride = 16): { result: QuadExpandResult; releaseSpy: jest.Mock } => {
  const releaseSpy = jest.fn();
  const result: QuadExpandResult = {
    buffer: ({ id } as unknown) as GPUBuffer,
    vertexCount,
    quadCount: Math.max(1, Math.floor(vertexCount / 6)),
    layout: 'pos2uv2',
    vertexStride: stride,
    winding: 'ccw',
    release: releaseSpy,
  };
  return { result, releaseSpy };
};

describe('ShapeFillMeshCache', () => {
  beforeEach(() => {
    resetShapeFillMeshCache();
  });

  it('reuses cached meshes for identical keys', () => {
    const cache = getShapeFillMeshCache();
    const { result, releaseSpy } = makeGeometry('mesh-a', 120);

    const stored = cache.store('mesh:key', 1, result);
    expect(stored.buffer).toBe(result.buffer);

    const again = cache.get('mesh:key', 1);
    expect(again).not.toBeNull();
    expect(again!.buffer).toBe(result.buffer);

    stored.release();
    again!.release();

    // Clearing the cache should dispose the underlying buffer exactly once.
    resetShapeFillMeshCache();
    expect(releaseSpy).toHaveBeenCalledTimes(1);
  });

  it('skips caching very large meshes', () => {
    const cache = getShapeFillMeshCache();
    const { result } = makeGeometry('large-mesh', 8_000_000); // ~128 MB

    const stored = cache.store('mesh:large', 1, result);
    expect(stored).toBe(result);

    const lookup = cache.get('mesh:large', 1);
    expect(lookup).toBeNull();
  });

  it('produces stable hashes for structured payloads', () => {
    const payload = { a: 1, b: { c: true, d: ['x', 'y'] } };
    const first = hashStructuredValue(payload);
    const second = hashStructuredValue({ b: { d: ['x', 'y'], c: true }, a: 1 });
    expect(first).toBe(second);
  });
});
