/* eslint-disable @typescript-eslint/no-explicit-any */
import { __TESTING__ } from '../webglExporter';
import { decodeColorCycleSpeedByte, encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';

describe('webglExporter helpers', () => {
  const {
    resolveDimensionFromCandidates,
    resolveRecolorSurfaceSize,
    clampBoundsToSurface,
    clampExportLayerSpeedScale,
    applyExportPlaybackScale,
    scaleEncodedSpeedBuffer
  } = __TESTING__;

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

  it('scales exported playback speed helpers', () => {
    expect(clampExportLayerSpeedScale(undefined)).toBe(1);
    expect(clampExportLayerSpeedScale(0)).toBe(0.01);
    expect(clampExportLayerSpeedScale(10)).toBe(3);

    expect(applyExportPlaybackScale(1.2, 0.5)).toBeCloseTo(0.6, 5);
    expect(applyExportPlaybackScale(null, 0.5)).toBeNull();
  });

  it('rescales encoded speed buffers', () => {
    const source = [encodeColorCycleSpeedByte(0.9), encodeColorCycleSpeedByte(0.3), 0];
    const scaled = scaleEncodedSpeedBuffer(source, 2);
    expect(decodeColorCycleSpeedByte(scaled[0])).toBeCloseTo(1.8, 1);
    expect(decodeColorCycleSpeedByte(scaled[1])).toBeCloseTo(0.6, 1);
    expect(scaled[2]).toBe(0);
  });
});
