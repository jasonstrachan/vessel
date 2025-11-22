import { __TESTING__, exportProjectAsWebGL } from '../webglExporter';

describe('webglExporter helpers', () => {
  const { resolveDimensionFromCandidates, resolveRecolorSurfaceSize, clampBoundsToSurface } = __TESTING__;

  it('resolves dimension candidates with fallback', () => {
    expect(resolveDimensionFromCandidates([undefined, null, 20], 10)).toBe(20);
    expect(resolveDimensionFromCandidates([0, -5], 10)).toBe(10);
  });

  it('resolves recolor surface size from layer/project', () => {
    const size = resolveRecolorSurfaceSize(
      { colorCycleData: { canvasWidth: 5, canvasHeight: 6 }, imageData: { width: 3, height: 4 } } as any,
      { width: 8, height: 9 } as any
    );
    expect(size).toEqual({ width: 3, height: 4 });
  });

  it('clamps bounds to surface', () => {
    const clamped = clampBoundsToSurface({ x: -1, y: -1, width: 5, height: 5 }, { width: 3, height: 3 });
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(0);
  });
});
