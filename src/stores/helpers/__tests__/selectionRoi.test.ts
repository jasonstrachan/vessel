import {
  clampMarqueeDragRectToBounds,
  clampSelectionBounds,
  copyRegionIntoTarget,
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
