import { SequentialCpuMaterializer } from '@/lib/sequential/materializer/SequentialCpuMaterializer';
import { buildSequentialBitmapPasteEvent } from '@/lib/sequential/sequentialEdit';
import type { FrameTileSet } from '@/lib/sequential/types';

const pixelsOf = (frame: FrameTileSet, width: number, height: number) => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (const tile of frame.tiles) {
    for (let y = 0; y < tile.height; y += 1) {
      pixels.set(tile.data.subarray(y * tile.width * 4, (y + 1) * tile.width * 4), ((tile.y + y) * width + tile.x) * 4);
    }
  }
  return pixels;
};

const bitmapEvent = (imageData: ImageData, x: number, y: number) => buildSequentialBitmapPasteEvent({
  layerId: 'bitmap', frameIndex: 0, imageData,
  bounds: { x, y, width: imageData.width, height: imageData.height },
  timestampMs: 0, id: `bitmap-${imageData.width}-${imageData.height}`, strokeId: 'bitmap',
});

describe('Sequence projected bitmap replay', () => {
  it.each([[82, 62], [62, 82], [82, 1], [1, 82]])('preserves every pixel of an unchanged %i × %i bitmap', (width, height) => {
    const image = new ImageData(width, height);
    const expected = new Uint8ClampedArray(256 * 256 * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const color = (x + y) % 3 === 0 ? [192, 32, 48, 255]
          : (x + y) % 3 === 1 ? [0, 0, 0, 0] : [255, 0, 0, 128];
        image.data.set(color, (y * width + x) * 4);
        // CPU tiles are premultiplied; the binary mask and half-alpha red are
        // independently known expected values, with no sampling in this oracle.
        expected.set(color[3] === 128 ? [128, 0, 0, 128] : color, ((97 + y) * 256 + 115 + x) * 4);
      }
    }
    const event = bitmapEvent(image, 115, 97);
    const original = JSON.stringify(event);
    const actual = pixelsOf(new SequentialCpuMaterializer().materializeFrame({
      width: 256, height: 256, frameIndex: 0, events: [event],
    }), 256, 256);
    expect(actual).toEqual(expected);
    expect(JSON.stringify(event)).toBe(original);
  });

  it('keeps the native rotated selection pixel at world 172,148', () => {
    const image = new ImageData(82, 62);
    image.data.set([192, 32, 48, 255], (51 * 82 + 57) * 4);
    const actual = pixelsOf(new SequentialCpuMaterializer().materializeFrame({
      width: 256, height: 256, frameIndex: 0, events: [bitmapEvent(image, 115, 97)],
    }), 256, 256);
    expect(Array.from(actual.subarray((148 * 256 + 172) * 4, (148 * 256 + 173) * 4))).toEqual([192, 32, 48, 255]);
    expect(actual.filter((_, index) => index % 4 === 3 && actual[index] > 0)).toHaveLength(1);
  });

  it('retains nearest-neighbor enlargement for custom stamps', () => {
    const image = new ImageData(3, 2);
    const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255];
    image.data.set([...red, ...green, ...blue, ...blue, ...red, ...green]);
    const event = bitmapEvent(image, 0, 0);
    event.brush.size = 6;
    event.stamps[0] = { ...event.stamps[0], size: 6, x: 3, y: 2 };
    const actual = pixelsOf(new SequentialCpuMaterializer().materializeFrame({
      width: 6, height: 4, frameIndex: 0, events: [event],
    }), 6, 4);
    const top = [...red, ...red, ...green, ...green, ...blue, ...blue];
    const bottom = [...blue, ...blue, ...red, ...red, ...green, ...green];
    expect(actual).toEqual(new Uint8ClampedArray([...top, ...top, ...bottom, ...bottom]));
  });
});
