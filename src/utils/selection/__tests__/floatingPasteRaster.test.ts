import {
  getFloatingPasteDestinationRect,
  intersectFloatingPasteBoundsWithProject,
  rasterizeFloatingPasteBitmap,
} from '@/utils/selection/floatingPasteRaster';

const makeImageData = (width: number, height: number): ImageData => {
  const imageData = new ImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      imageData.data[index] = x + y * width;
      imageData.data[index + 1] = 0;
      imageData.data[index + 2] = 0;
      imageData.data[index + 3] = 255;
    }
  }
  return imageData;
};

const redChannel = (canvas: HTMLCanvasElement): number[] => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return [];
  }
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const values: number[] = [];
  for (let index = 0; index < imageData.data.length; index += 4) {
    values.push(imageData.data[index] ?? 0);
  }
  return values;
};

describe('floatingPasteRaster', () => {
  it('uses display size and position for destination rect', () => {
    expect(
      getFloatingPasteDestinationRect({
        imageData: makeImageData(4, 2),
        width: 4,
        height: 2,
        displayWidth: 1.5,
        displayHeight: 3.25,
        position: { x: 10.4, y: 12.6 },
      })
    ).toEqual({ x: 10.4, y: 12.6, width: 1.5, height: 3.25 });
  });

  it('clips bounds to integer project ROI with floor and ceil edges', () => {
    expect(
      intersectFloatingPasteBoundsWithProject(
        { x: -1.2, y: 3.4, width: 5.7, height: 2.2 },
        { width: 4, height: 8 }
      )
    ).toEqual({ x: 0, y: 3, width: 4, height: 3 });
  });

  it('bakes scaled preview pixels from the original source', () => {
    const raster = rasterizeFloatingPasteBitmap(
      {
        imageData: makeImageData(4, 1),
        width: 4,
        height: 1,
        displayWidth: 2,
        displayHeight: 1,
        position: { x: 0, y: 0 },
      },
      { width: 8, height: 8 }
    );

    expect(raster?.roi).toEqual({ x: 0, y: 0, width: 2, height: 1 });
    expect(raster ? redChannel(raster.canvas) : []).toEqual([1, 3]);
  });

  it('bakes scale-up output with nearest-neighbor chunky pixels', () => {
    const raster = rasterizeFloatingPasteBitmap(
      {
        imageData: makeImageData(2, 1),
        width: 2,
        height: 1,
        displayWidth: 4,
        displayHeight: 1,
        position: { x: 0, y: 0 },
      },
      { width: 8, height: 8 }
    );

    expect(raster?.roi).toEqual({ x: 0, y: 0, width: 4, height: 1 });
    expect(raster ? redChannel(raster.canvas) : []).toEqual([0, 0, 1, 1]);
  });

  it('regenerates each bake from the original image data', () => {
    const imageData = makeImageData(4, 1);
    const small = rasterizeFloatingPasteBitmap(
      {
        imageData,
        width: 4,
        height: 1,
        displayWidth: 2,
        displayHeight: 1,
        position: { x: 0, y: 0 },
      },
      { width: 8, height: 8 }
    );
    const full = rasterizeFloatingPasteBitmap(
      {
        imageData,
        width: 4,
        height: 1,
        displayWidth: 4,
        displayHeight: 1,
        position: { x: 0, y: 0 },
      },
      { width: 8, height: 8 }
    );

    expect(small ? redChannel(small.canvas) : []).toEqual([1, 3]);
    expect(full ? redChannel(full.canvas) : []).toEqual([0, 1, 2, 3]);
  });

  it('bakes partially off-canvas pixels into ROI-local output', () => {
    const raster = rasterizeFloatingPasteBitmap(
      {
        imageData: makeImageData(4, 1),
        width: 4,
        height: 1,
        displayWidth: 4,
        displayHeight: 1,
        position: { x: -2, y: 0 },
      },
      { width: 8, height: 8 }
    );

    expect(raster?.roi).toEqual({ x: 0, y: 0, width: 2, height: 1 });
    expect(raster ? redChannel(raster.canvas) : []).toEqual([2, 3]);
  });

  it('returns null for empty clipped bounds', () => {
    expect(
      rasterizeFloatingPasteBitmap(
        {
          imageData: makeImageData(2, 2),
          width: 2,
          height: 2,
          position: { x: 10, y: 10 },
        },
        { width: 8, height: 8 }
      )
    ).toBeNull();
  });
});
