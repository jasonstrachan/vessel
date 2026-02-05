import { inferFallbackRoiFromStateDiff } from '@/history/helpers/layerHistory';
import type { ColorCycleSerializedState } from '@/history/helpers/colorCycle';

const makeState = (bytes: Uint8Array): ColorCycleSerializedState =>
  ({
    layers: [
      {
        layerId: 'layer-1',
        strokeData: {
          paintBuffer: bytes.buffer,
          strokeCounter: 0,
        },
      },
    ],
  }) as ColorCycleSerializedState;

describe('inferFallbackRoiFromStateDiff', () => {
  it('falls back to a finer scan for tiny diffs', () => {
    const width = 64;
    const height = 64;
    const before = new Uint8Array(width * height);
    const after = new Uint8Array(width * height);
    after[1 * width + 1] = 1;

    const roi = inferFallbackRoiFromStateDiff(
      makeState(before),
      makeState(after),
      width,
      height,
      16
    );

    expect(roi).not.toBeNull();
    expect(roi!.width).toBeLessThan(width);
    expect(roi!.height).toBeLessThan(height);
    expect(roi!.x).toBeLessThanOrEqual(1);
    expect(roi!.y).toBeLessThanOrEqual(1);
    expect(roi!.x + roi!.width).toBeGreaterThan(1);
    expect(roi!.y + roi!.height).toBeGreaterThan(1);
  });

  it('returns null when there are no diffs', () => {
    const width = 32;
    const height = 32;
    const before = new Uint8Array(width * height);
    const after = new Uint8Array(width * height);

    const roi = inferFallbackRoiFromStateDiff(
      makeState(before),
      makeState(after),
      width,
      height,
      16
    );

    expect(roi).toBeNull();
  });
});
