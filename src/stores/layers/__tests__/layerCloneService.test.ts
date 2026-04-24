import {
  cloneCanvasLike,
  cloneImageData,
  createCanvas,
  normalizeImageDataDimensions,
  snapshotFramebufferRegion,
} from '@/stores/layers/layerCloneService';

const pixelAt = (imageData: ImageData, x: number, y: number): number[] => {
  const index = (y * imageData.width + x) * 4;
  return Array.from(imageData.data.slice(index, index + 4));
};

describe('layerCloneService', () => {
  it('clones ImageData without sharing the pixel buffer', () => {
    const source = new ImageData(new Uint8ClampedArray([1, 2, 3, 4]), 1, 1);

    const cloned = cloneImageData(source);

    expect(cloned).not.toBe(source);
    expect(cloned?.data).not.toBe(source.data);
    expect(Array.from(cloned?.data ?? [])).toEqual([1, 2, 3, 4]);

    source.data[0] = 99;
    expect(cloned?.data[0]).toBe(1);
  });

  it('normalizes ImageData dimensions by copying overlapping pixels', () => {
    const source = new ImageData(
      new Uint8ClampedArray([
        1, 2, 3, 4,
        5, 6, 7, 8,
        9, 10, 11, 12,
        13, 14, 15, 16,
      ]),
      2,
      2
    );

    const normalized = normalizeImageDataDimensions(source, 3, 1);

    expect(normalized.width).toBe(3);
    expect(normalized.height).toBe(1);
    expect(pixelAt(normalized, 0, 0)).toEqual([1, 2, 3, 4]);
    expect(pixelAt(normalized, 1, 0)).toEqual([5, 6, 7, 8]);
    expect(pixelAt(normalized, 2, 0)).toEqual([0, 0, 0, 0]);
  });

  it('creates DOM canvases when forced', () => {
    const canvas = createCanvas(4, 5, { forceDom: true });

    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(canvas?.width).toBe(4);
    expect(canvas?.height).toBe(5);
  });

  it('creates a canvas clone from fallback ImageData', () => {
    const fallback = new ImageData(new Uint8ClampedArray([20, 30, 40, 255]), 1, 1);

    const canvas = cloneCanvasLike(null, fallback, { forceDom: true }) as HTMLCanvasElement;
    const snapshot = canvas.getContext('2d')?.getImageData(0, 0, 1, 1);

    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(snapshot ? pixelAt(snapshot, 0, 0) : null).toEqual([20, 30, 40, 255]);
  });

  it('snapshots framebuffer pixels within requested bounds', () => {
    const canvas = createCanvas(2, 2, { forceDom: true }) as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    ctx?.putImageData(
      new ImageData(
        new Uint8ClampedArray([
          1, 2, 3, 255,
          4, 5, 6, 255,
          7, 8, 9, 255,
          10, 11, 12, 255,
        ]),
        2,
        2
      ),
      0,
      0
    );

    const snapshot = snapshotFramebufferRegion(canvas, 1, 2);

    expect(snapshot?.width).toBe(1);
    expect(snapshot?.height).toBe(2);
    expect(snapshot ? pixelAt(snapshot, 0, 0) : null).toEqual([1, 2, 3, 255]);
    expect(snapshot ? pixelAt(snapshot, 0, 1) : null).toEqual([7, 8, 9, 255]);
  });
});
