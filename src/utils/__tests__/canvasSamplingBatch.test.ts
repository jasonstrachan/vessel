import { readCanvasSamplingRegion, withCanvasSamplingBatch } from '../canvasSamplingBatch';

const makeContext = () => {
  const getImageData = jest.fn((x: number, y: number, width: number, height: number) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const offset = (row * width + col) * 4;
        data[offset] = (x + col) % 256;
        data[offset + 1] = y + row;
        data[offset + 3] = 255;
      }
    }
    return { width, height, data } as ImageData;
  });
  const context = { canvas: { width: 300, height: 10 }, getImageData } as unknown as CanvasRenderingContext2D;
  return { context, getImageData };
};

describe('canvas sampling batches', () => {
  it('shares bounded readbacks while preserving regions across tile boundaries', () => {
    const { context, getImageData } = makeContext();
    const expected = readCanvasSamplingRegion(context, 255, 3, 3, 2);
    getImageData.mockClear();
    withCanvasSamplingBatch(() => {
      for (let i = 0; i < 256; i++) readCanvasSamplingRegion(context, i, 3, 1, 1);
      expect(readCanvasSamplingRegion(context, 255, 3, 3, 2)).toEqual(expected);
    });
    expect(getImageData).toHaveBeenCalledTimes(2);
    expect(getImageData).toHaveBeenLastCalledWith(256, 0, 44, 10);
  });

  it('shares nested passes but releases snapshots even when sampling throws', () => {
    const { context, getImageData } = makeContext();
    expect(() => withCanvasSamplingBatch(() => {
      readCanvasSamplingRegion(context, 1, 1, 1, 1);
      withCanvasSamplingBatch(() => readCanvasSamplingRegion(context, 2, 1, 1, 1));
      throw new Error('sample failed');
    })).toThrow('sample failed');
    expect(getImageData).toHaveBeenCalledTimes(1);
    readCanvasSamplingRegion(context, 1, 1, 1, 1);
    expect(getImageData).toHaveBeenLastCalledWith(1, 1, 1, 1);
    withCanvasSamplingBatch(() => readCanvasSamplingRegion(context, 1, 1, 1, 1));
    expect(getImageData).toHaveBeenCalledTimes(3);
  });
});
