import {
  adjustSelectionMaskByPixels,
  clampMarqueeDragRectToBounds,
  clampSelectionBounds,
  copyRegionIntoTarget,
  fillRasterWithinSelection,
  hasVisibleSelectionMask,
} from '@/stores/helpers/selectionRoi';

const createImageData = (width: number, height: number, fill = 0): ImageData => {
  const data = new Uint8ClampedArray(width * height * 4).fill(fill);
  return new ImageData(data, width, height);
};

describe('clampSelectionBounds', () => {
  it('clamps marquee drag edges to the provided image bounds', () => {
    const result = clampMarqueeDragRectToBounds({ x: -25, y: -10 }, { x: 45, y: 30 }, 100, 80);
    expect(result).toEqual({ x: 0, y: 0, width: 45, height: 30 });
  });

  it('clamps selection within the provided image bounds', () => {
    const result = clampSelectionBounds({ x: -4, y: 10, width: 50, height: 30 }, 32, 32);
    expect(result).toEqual({ x: 0, y: 10, width: 32, height: 22 });
  });

  it('returns null for empty or negative bounds', () => {
    expect(clampSelectionBounds({ x: 0, y: 0, width: 0, height: 5 }, 10, 10)).toBeNull();
    expect(clampSelectionBounds({ x: 0, y: 0, width: 5, height: -2 }, 10, 10)).toBeNull();
  });
});

describe('copyRegionIntoTarget', () => {
  it('copies the specified region from source to target', () => {
    const source = createImageData(4, 4);
    for (let i = 0; i < source.data.length; i += 4) {
      source.data[i] = 255; // R
      source.data[i + 1] = 64; // G
      source.data[i + 2] = 32; // B
      source.data[i + 3] = 255; // A
    }

    const target = createImageData(4, 4);
    copyRegionIntoTarget(source, target, { x: 1, y: 1, width: 2, height: 2 });

    const readPixel = (image: ImageData, x: number, y: number) => {
      const index = (y * image.width + x) * 4;
      return image.data.slice(index, index + 4);
    };

    expect(readPixel(target, 1, 1)).toEqual(Uint8ClampedArray.from([255, 64, 32, 255]));
    expect(readPixel(target, 2, 2)).toEqual(Uint8ClampedArray.from([255, 64, 32, 255]));
    expect(readPixel(target, 0, 0)).toEqual(Uint8ClampedArray.from([0, 0, 0, 0]));
  });
});

describe('hasVisibleSelectionMask', () => {
  it('returns false when the mask has no selected pixels', () => {
    expect(hasVisibleSelectionMask(createImageData(2, 2))).toBe(false);
  });

  it('returns true when the mask contains selected pixels', () => {
    const mask = createImageData(2, 2);
    mask.data[3] = 255;

    expect(hasVisibleSelectionMask(mask)).toBe(true);
  });
});

describe('adjustSelectionMaskByPixels', () => {
  const selectPixel = (mask: ImageData, x: number, y: number): void => {
    const index = (y * mask.width + x) * 4;
    mask.data[index] = 255;
    mask.data[index + 1] = 255;
    mask.data[index + 2] = 255;
    mask.data[index + 3] = 255;
  };

  it('insets every edge of a mask and crops the result to selected pixels', () => {
    const mask = createImageData(5, 5);
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        selectPixel(mask, x, y);
      }
    }

    const result = adjustSelectionMaskByPixels(
      mask,
      { x: 3, y: 4, width: 5, height: 5 },
      -1,
      12,
      12,
    );

    expect(result?.bounds).toEqual({ x: 4, y: 5, width: 3, height: 3 });
    expect(Array.from(result?.mask.data ?? [])).toEqual(new Array(3 * 3 * 4).fill(255));
  });

  it('expands a mask contour and clamps it to the image bounds', () => {
    const mask = createImageData(1, 1);
    selectPixel(mask, 0, 0);

    const result = adjustSelectionMaskByPixels(
      mask,
      { x: 0, y: 1, width: 1, height: 1 },
      1,
      3,
      3,
    );

    expect(result?.bounds).toEqual({ x: 0, y: 0, width: 2, height: 3 });
    expect(Array.from(result?.mask.data ?? [])).toEqual(new Array(2 * 3 * 4).fill(255));
  });

  it('returns null when an inset would remove every selected pixel', () => {
    const mask = createImageData(3, 3);
    selectPixel(mask, 1, 1);

    expect(adjustSelectionMaskByPixels(
      mask,
      { x: 2, y: 2, width: 3, height: 3 },
      -1,
      8,
      8,
    )).toBeNull();
  });
});

describe('fillRasterWithinSelection', () => {
  it('fills every pixel in a rectangular selection regardless of its source color', () => {
    const image = createImageData(4, 1);
    image.data.set([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 0, 255,
    ]);

    const bounds = fillRasterWithinSelection(
      image,
      { x: 1, y: 0, width: 2, height: 1 },
      { r: 12, g: 34, b: 56, a: 255 },
      null,
      null,
    );

    expect(bounds).toEqual({ x: 1, y: 0, width: 2, height: 1 });
    expect(Array.from(image.data)).toEqual([
      255, 0, 0, 255,
      12, 34, 56, 255,
      12, 34, 56, 255,
      255, 255, 0, 255,
    ]);
  });

  it('fills only visible pixels in a mask-backed selection', () => {
    const image = createImageData(3, 1, 90);
    const mask = createImageData(3, 1);
    mask.data[7] = 255;

    const bounds = fillRasterWithinSelection(
      image,
      { x: 0, y: 0, width: 3, height: 1 },
      { r: 0, g: 0, b: 0, a: 255 },
      mask,
      { x: 0, y: 0, width: 3, height: 1 },
    );

    expect(bounds).toEqual({ x: 1, y: 0, width: 1, height: 1 });
    expect(Array.from(image.data)).toEqual([
      90, 90, 90, 90,
      0, 0, 0, 255,
      90, 90, 90, 90,
    ]);
  });

  it('returns no bounds when every selected pixel already matches the fill color', () => {
    const image = createImageData(2, 1);
    image.data.set([
      0, 0, 0, 255,
      0, 0, 0, 255,
    ]);

    const bounds = fillRasterWithinSelection(
      image,
      { x: 0, y: 0, width: 2, height: 1 },
      { r: 0, g: 0, b: 0, a: 255 },
      null,
      null,
    );

    expect(bounds).toBeNull();
  });
});
