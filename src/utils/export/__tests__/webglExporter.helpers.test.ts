/* eslint-disable @typescript-eslint/no-explicit-any */
import { __TESTING__ } from '../webglExporter';
import { decodeColorCycleSpeedByte, encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';

const {
  resolveDimensionFromCandidates,
  resolveRecolorSurfaceSize,
  clampBoundsToSurface,
  clampExportLayerSpeedScale,
  applyExportPlaybackScale,
  scaleEncodedSpeedBuffer
} = __TESTING__;

describe('webglExporter helpers', () => {
  it('resolves first positive numeric candidate and clamps to >=1', () => {
    expect(resolveDimensionFromCandidates([null, '5', 0], 10)).toBe(5);
    expect(resolveDimensionFromCandidates([undefined, -2], 0)).toBe(1);
  });

  it('derives recolor surface size from layer fallbacks and project', () => {
    const project = { width: 200, height: 150 } as any;
    const layer = { colorCycleData: { recolorSettings: { originalImageData: { width: 50, height: 60 } } } } as any;
    expect(resolveRecolorSurfaceSize(layer, project)).toEqual({ width: 50, height: 60 });

    const layerNoImage = { colorCycleData: {}, imageData: { width: 80, height: 90 } } as any;
    expect(resolveRecolorSurfaceSize(layerNoImage, project)).toEqual({ width: 80, height: 90 });
  });

  it('clamps bounds to surface dimensions', () => {
    const bounds = { x: -5, y: -5, width: 20, height: 20 } as any;
    const surface = { width: 10, height: 12 };
    const clamped = clampBoundsToSurface(bounds, surface);
    expect(clamped.x).toBeGreaterThanOrEqual(0);
    expect(clamped.y).toBeGreaterThanOrEqual(0);
    expect(clamped.width).toBeLessThanOrEqual(surface.width);
    expect(clamped.height).toBeLessThanOrEqual(surface.height);
  });

  it('clamps export layer speed scale and applies scaled playback speeds', () => {
    expect(clampExportLayerSpeedScale(undefined)).toBe(1);
    expect(clampExportLayerSpeedScale(0)).toBe(0.0005);
    expect(clampExportLayerSpeedScale(10)).toBe(3);

    expect(applyExportPlaybackScale(0.8, 0.5)).toBeCloseTo(0.4, 5);
    expect(applyExportPlaybackScale(null, 0.5)).toBeNull();
  });

  it('scales encoded speed buffers for goblet speed parity', () => {
    const buffer = [encodeColorCycleSpeedByte(1.2), encodeColorCycleSpeedByte(0.4), 0];
    const scaledHalf = scaleEncodedSpeedBuffer(buffer, 0.5);
    expect(decodeColorCycleSpeedByte(scaledHalf[0])).toBeCloseTo(0.6, 1);
    expect(decodeColorCycleSpeedByte(scaledHalf[1])).toBeCloseTo(0.2, 1);
    expect(scaledHalf[2]).toBe(0);
  });
});
