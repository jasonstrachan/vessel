import { BrushShape, type SequentialSelectionClip, type SequentialStrokeEvent } from '@/types';
import { SequentialCpuMaterializer } from '@/lib/sequential/materializer/SequentialCpuMaterializer';
import type { FrameTileSet } from '@/lib/sequential/types';

const WIDTH = 16;
const pixelsOf = (frame: FrameTileSet): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(WIDTH * WIDTH * 4);
  for (const tile of frame.tiles) {
    for (let y = 0; y < tile.height; y += 1) {
      pixels.set(tile.data.subarray(y * tile.width * 4, (y + 1) * tile.width * 4), ((tile.y + y) * WIDTH + tile.x) * 4);
    }
  }
  return pixels;
};
const event = (id: string, color: string): SequentialStrokeEvent => ({
  id, layerId: 'seq', strokeId: id, timestampMs: 0, frameIndex: 0,
  brush: {
    tool: 'brush', brushShape: BrushShape.SQUARE, size: 16, opacity: 1,
    blendMode: 'source-over', rotation: 0, spacing: 1, color,
  },
  stamps: [{ x: 8, y: 8, pressure: 1, rotation: 0, size: 16, alpha: 1 }],
});
const render = (events: SequentialStrokeEvent[]): Uint8ClampedArray => pixelsOf(new SequentialCpuMaterializer().materializeFrame({
  width: WIDTH, height: WIDTH, frameIndex: 0, events,
}));

const modes: Array<[string, Partial<SequentialStrokeEvent['brush']>]> = [
  ['square', {}],
  ['round', { brushShape: BrushShape.ROUND }],
  ['triangle', { brushShape: BrushShape.TRIANGLE }],
  ['dither Bayer', { ditherEnabled: true, ditherAlgorithm: 'bayer' }],
  ['dither Sierra Lite', { ditherEnabled: true, ditherAlgorithm: 'sierra-lite' }],
  ['mosaic', { brushShape: BrushShape.MOSAIC, mosaicTilePx: 2, mosaicSeed: 42 }],
  ['soft riso', { brushShape: BrushShape.RISOGRAPH_SOFT }],
  ['ultra riso', { brushShape: BrushShape.RISOGRAPH_ULTRA }],
  ['particles', { pluginBrushId: 'particle-brush', pluginConfig: { particleDensity: 30, particleScatterRadius: 1 } }],
  ['spam', { pluginBrushId: 'spam-brush' }],
  ...[false, true].map((isColorizable): [string, Partial<SequentialStrokeEvent['brush']>] => [
    `custom ${isColorizable ? 'tinted' : 'RGBA'}`,
    { customStampHash: `selection-custom-${isColorizable}`, customStamp: {
      width: 2, height: 2, isColorizable,
      rgbaBase64: Buffer.from([0, 255, 0, 255, 0, 0, 255, 80, 0, 255, 255, 160, 255, 255, 255, 255]).toString('base64'),
    } },
  ]),
];
const scopes: Array<[string, SequentialSelectionClip, (x: number, y: number) => boolean]> = [
  ['fractional rectangle', { kind: 'rect', minX: 4.2, minY: 3.8, maxX: 10.1, maxY: 11.4 }, (x, y) => x >= 5 && x <= 10 && y >= 4 && y <= 11],
  ['partly outside rectangle', { kind: 'rect', minX: -2, minY: -3, maxX: 8, maxY: 8 }, (x, y) => x < 8 && y < 8],
  ['hole', { kind: 'mask', x: 0, y: 0, width: WIDTH, height: WIDTH,
    alphaBase64: Buffer.from(Array.from({ length: WIDTH * WIDTH }, (_, i) => i % WIDTH >= 6 && i % WIDTH < 10 && Math.floor(i / WIDTH) >= 6 && Math.floor(i / WIDTH) < 10 ? 0 : 1)).toString('base64'),
  }, (x, y) => !(x >= 6 && x < 10 && y >= 6 && y < 10)],
  ['complement', { kind: 'mask', x: 0, y: 0, width: WIDTH, height: WIDTH,
    alphaBase64: Buffer.from(Array.from({ length: WIDTH * WIDTH }, (_, i) => i % WIDTH >= 4 && i % WIDTH < 12 ? 0 : 1)).toString('base64'),
  }, (x) => x < 4 || x >= 12],
  ['empty mask', { kind: 'mask', x: 0, y: 0, width: WIDTH, height: WIDTH, alphaBase64: Buffer.alloc(WIDTH * WIDTH).toString('base64') }, () => false],
];

describe('recorded Sequence selection scope', () => {
  it.each(modes)('%s preserves selected control pixels and excluded base pixels in every scope and blend mode', (_label, brush) => {
    for (const blendMode of ['source-over', 'destination-out'] as const) {
      for (const [, selectionClip, contains] of scopes) {
        const base = event('base', '#ff0000');
        const paint = event('paint', '#0000ff');
        paint.brush = { ...paint.brush, ...brush, blendMode };
        paint.stamps[0].alpha = 0.65;
        const before = render([base]);
        const control = render([base, paint]);
        expect(control).not.toEqual(before);
        paint.brush = { ...paint.brush, selectionClip };
        const snapshot = JSON.stringify(paint);
        const actual = render([base, paint]);
        const expected = before.slice();
        for (let y = 0; y < WIDTH; y += 1) {
          for (let x = 0; x < WIDTH; x += 1) {
            if (contains(x, y)) {
              const offset = (y * WIDTH + x) * 4;
              expected.set(control.subarray(offset, offset + 4), offset);
            }
          }
        }
        expect(actual).toEqual(expected);
        expect(JSON.stringify(paint)).toBe(snapshot);
      }
    }
  });

  it('preserves every excluded pixel and matches unrestricted paint inside the rectangle', () => {
    const base = event('base', '#ff0000');
    const paint = event('paint', '#0000ff');
    const before = render([base]);
    const control = render([base, paint]);
    Object.assign(paint.brush, { selectionClip: { kind: 'rect', minX: 4, minY: 3, maxX: 10, maxY: 11 } });
    const actual = render([base, paint]);
    const expected = before.slice();
    for (let y = 3; y < 11; y += 1) {
      for (let x = 4; x < 10; x += 1) {
        const offset = (y * WIDTH + x) * 4;
        expected.set(control.subarray(offset, offset + 4), offset);
      }
    }
    expect(actual).toEqual(expected);
  });
});
