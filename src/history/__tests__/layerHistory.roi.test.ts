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

it('includes distant sparse contour pixels even when the coarse grid finds ink', () => {
  const width = 256, height = 256;
  const before = new Uint8Array(width * height);
  const after = before.slice();
  for (const [x, y] of [[144, 96], [34, 86], [213, 131]]) after[y * width + x] = 77;
  const roi = inferFallbackRoiFromStateDiff(makeState(before), makeState(after), width, height);
  expect(roi).not.toBeNull();
  for (const [x, y] of [[144, 96], [34, 86], [213, 131]]) {
    expect(roi!.x).toBeLessThanOrEqual(x);
    expect(roi!.y).toBeLessThanOrEqual(y);
    expect(roi!.x + roi!.width).toBeGreaterThan(x);
    expect(roi!.y + roi!.height).toBeGreaterThan(y);
  }
});

it.each(['gradientIdBuffer', 'gradientDefIdBuffer', 'speedBuffer', 'flowBuffer', 'phaseBuffer'] as const)(
  'includes distant %s changes even when paint indices stay the same there', key => {
    const width = 256, height = 64;
    const before = makeState(new Uint8Array(width * height))!;
    const after = makeState(new Uint8Array(width * height))!;
    new Uint8Array(after.layers[0].strokeData!.paintBuffer!)[16 * width + 16] = 1;
    const makeBuffer = () => key === 'gradientDefIdBuffer' ? new Uint16Array(width * height) : new Uint8Array(width * height);
    const prev = makeBuffer(), next = makeBuffer();
    next[31 * width + 231] = key === 'gradientDefIdBuffer' ? 256 : 91;
    before.layers[0].strokeData![key] = prev.buffer;
    after.layers[0].strokeData![key] = next.buffer;
    const roi = inferFallbackRoiFromStateDiff(before, after, width, height);
    expect(roi).not.toBeNull();
    expect(roi!.x + roi!.width).toBeGreaterThan(231);
    expect(roi!.y + roi!.height).toBeGreaterThan(31);
  },
);
